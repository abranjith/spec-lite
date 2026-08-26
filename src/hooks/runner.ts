/**
 * Dispatch: resolve the registry, build the payload, and run every hook
 * subscribed to one event, in order. This is the only place that enforces the
 * reentrancy guard and the failure policy.
 */
import path from "node:path";
import fs from "fs-extra";
import { loadRegistry, hooksForEvent } from "./registry.js";
import { buildPayload, writePayloadFile, refreshChanges, type BuildPayloadOptions } from "./payload.js";
import { runShellHook } from "./executors/shell.js";
import { runHttpHook } from "./executors/http.js";
import { runBuiltinHook } from "./executors/builtin.js";
import { emitAgenticDirective } from "./executors/agentic.js";
import { isAgenticKind } from "./types.js";
import { getEvent } from "./events.js";
import { hooksLogPath, readProjectConfig } from "./workspace.js";
import { previewHook } from "./preview.js";
import { validatePayloadForHook } from "./payload-validation.js";
import type { HookPayload, HookResult, ResolvedHook } from "./types.js";
import type { ResolveContext } from "./interpolation.js";

const MAX_HOOK_DEPTH = 3;

export interface RunEventOptions extends BuildPayloadOptions {
  dryRun?: boolean;
  /** Restrict dispatch to a single hook by name — used by `spec-lite hook test`. */
  only?: string;
}

export interface RunEventReport {
  payload: HookPayload;
  results: HookResult[];
  exitCode: 0 | 1 | 2;
  registryIssues: string[];
  /** True when `.spec-lite.json` has `hooks.enabled: false` — nothing dispatched. */
  disabled?: boolean;
}

/** Repository-wide kill switch from `.spec-lite.json` → `hooks.enabled`. */
async function hooksDisabled(root: string): Promise<boolean> {
  const config = await readProjectConfig(root);
  return config.hooks?.enabled === false;
}

function currentChain(): { depth: number; chain: string[] } {
  const depth = parseInt(process.env.SPEC_LITE_HOOK_DEPTH ?? "0", 10) || 0;
  const chain = (process.env.SPEC_LITE_HOOK_CHAIN ?? "").split(",").filter(Boolean);
  return { depth, chain };
}

async function appendLog(root: string, featureDir: string | undefined, result: HookResult): Promise<void> {
  if (!featureDir) return;
  const file = hooksLogPath(root, featureDir);
  await fs.ensureDir(path.dirname(file));
  const line = JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n";
  await fs.appendFile(file, line, "utf-8");
}

async function alreadyRanOnce(root: string, featureDir: string | undefined, hookName: string, event: string): Promise<boolean> {
  if (!featureDir) return false;
  const file = hooksLogPath(root, featureDir);
  if (!(await fs.pathExists(file))) return false;
  const content = await fs.readFile(file, "utf-8");
  for (const line of content.split("\n").filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as HookResult;
      if (entry.name === hookName && entry.event === event && (entry.status === "ok" || entry.status === "emitted")) return true;
    } catch {
      /* ignore malformed line */
    }
  }
  return false;
}

export async function runEvent(opts: RunEventOptions): Promise<RunEventReport> {
  const { depth, chain } = currentChain();
  const payload = await buildPayload(opts);

  if (depth >= MAX_HOOK_DEPTH) {
    return {
      payload,
      results: [{
        name: "*", event: opts.event, kind: "command", status: "failed", durationMs: 0,
        message: `hook reentrancy depth ${depth} >= ${MAX_HOOK_DEPTH}; aborting to prevent a loop`,
      }],
      exitCode: 2,
      registryIssues: [],
    };
  }

  if (await hooksDisabled(opts.root)) {
    return { payload, results: [], exitCode: 0, registryIssues: [], disabled: true };
  }

  // An event outside the catalog is a contract error, not a quiet no-op: a
  // typo'd event name in a role would otherwise silently skip every hook
  // subscribed to the event that was meant. The kill switch above still wins,
  // so a clone with hooks disabled never fails on one.
  if (!getEvent(opts.event)) {
    return {
      payload,
      results: [{
        name: "*", event: opts.event, kind: "command", status: "failed", durationMs: 0,
        contractError: true,
        message: `unknown event "${opts.event}" — run \`spec-lite hook events\` for the catalog`,
      }],
      exitCode: 2,
      registryIssues: [],
    };
  }

  const { hooks: allHooks, issues } = await loadRegistry(opts.root);
  const subscribed = hooksForEvent(allHooks, opts.event).filter(
    (h) => !opts.only || h.name === opts.only
  );
  const registryIssues = issues.map((i) => `[${i.level}] ${i.hook ? `${i.hook}: ` : ""}${i.message}`);

  // A registry error means the configuration itself is wrong. Run nothing:
  // firing a partially-valid registry is how side effects happen against a
  // config the user has not actually got right yet.
  if (issues.some((i) => i.level === "error")) {
    return { payload, results: [], exitCode: 2, registryIssues };
  }

  const payloadFile = opts.dryRun ? undefined : await writePayloadFile(payload);
  const results: HookResult[] = [];
  let aborted = false;
  let contractFailed = false;

  for (const hook of subscribed) {
    const chainKey = `${opts.event}:${hook.name}`;
    if (chain.includes(chainKey)) {
      results.push({ name: hook.name, event: opts.event, kind: hook.type, status: "skipped", durationMs: 0, message: "reentrant within this chain" });
      continue;
    }
    if (hook.once && (await alreadyRanOnce(opts.root, payload.feature?.dir, hook.name, opts.event))) {
      results.push({ name: hook.name, event: opts.event, kind: hook.type, status: "skipped", durationMs: 0, message: "already ran once for this event" });
      continue;
    }

    const ctx: ResolveContext = { payload, payloadFile };

    // Validate the payload against the hook's declared contract BEFORE doing
    // anything with side effects.
    const validation = validatePayloadForHook(hook, payload);
    if (!validation.ok) {
      const result: HookResult = {
        name: hook.name, event: opts.event, kind: hook.type, status: "failed",
        durationMs: 0, message: validation.message, contractError: true,
      };
      results.push(result);
      await appendLog(opts.root, payload.feature?.dir, result);
      contractFailed = true;
      break;
    }

    if (opts.dryRun) {
      const preview = previewHook(hook, ctx);
      results.push({
        name: hook.name, event: opts.event, kind: hook.type, status: "skipped", durationMs: 0,
        message: "dry run — not executed", preview,
      });
      continue;
    }

    const result = await dispatch(hook, ctx, opts.root, depth, [...chain, chainKey]);
    results.push(result);
    await appendLog(opts.root, payload.feature?.dir, result);

    if (result.status === "ok" || result.status === "emitted") {
      // Builtins and user scripts alike may have written changeset.json —
      // refresh so later hooks in this same chain see it.
      await refreshChanges(opts.root, payload);
    }

    if (result.contractError) {
      // Could not be invoked at all — bypasses onFailure by design.
      contractFailed = true;
      break;
    }

    if (result.status === "failed") {
      const policy = hook.onFailure ?? "warn";
      if (policy === "abort") {
        aborted = true;
        break;
      }
    }
  }

  const failures = results.filter((r) => r.status === "failed");
  if (failures.length > 0) {
    await emitHookError(opts, payload, failures, depth, chain);
  }

  const exitCode: 0 | 1 | 2 = contractFailed ? 2 : aborted ? 1 : 0;
  return { payload, results, exitCode, registryIssues };
}

/**
 * Fire `hook.error` so failures can be routed somewhere visible.
 *
 * Guarded against recursion two ways: it never fires while already handling
 * `hook.error`, and the handlers run through the normal chain key so a
 * hook.error handler that itself fails cannot loop back into this function.
 */
async function emitHookError(
  opts: RunEventOptions,
  payload: HookPayload,
  failures: HookResult[],
  depth: number,
  chain: string[]
): Promise<void> {
  if (opts.event === "hook.error" || opts.dryRun) return;

  const { hooks } = await loadRegistry(opts.root);
  const handlers = hooksForEvent(hooks, "hook.error");
  if (handlers.length === 0) return;

  const errorPayload = await buildPayload({
    ...opts,
    event: "hook.error",
    extra: {
      ...(opts.extra ?? {}),
      summary: `${failures.length} hook(s) failed on ${opts.event}: ${failures
        .map((f) => `${f.name} (${f.message ?? "no message"})`)
        .join("; ")}`,
      failedEvent: opts.event,
    },
  });

  const payloadFile = await writePayloadFile(errorPayload);
  for (const handler of handlers) {
    const chainKey = `hook.error:${handler.name}`;
    if (chain.includes(chainKey)) continue;
    const result = await dispatch(handler, { payload: errorPayload, payloadFile }, opts.root, depth, [...chain, chainKey]);
    await appendLog(opts.root, payload.feature?.dir, result);
  }
}

async function dispatch(
  hook: ResolvedHook,
  ctx: ResolveContext,
  root: string,
  depth: number,
  chain: string[]
): Promise<HookResult> {
  const reentrancyEnv = { SPEC_LITE_HOOK_DEPTH: String(depth + 1), SPEC_LITE_HOOK_CHAIN: chain.join(",") };

  if (isAgenticKind(hook.type)) return emitAgenticDirective(hook, ctx);

  switch (hook.type) {
    case "builtin":
      return runBuiltinHook(hook, ctx, root);
    case "http":
      return runHttpHook(hook, ctx);
    case "command":
    case "script":
      return runShellHook(hook, ctx, root, reentrancyEnv);
    default:
      return { name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed", durationMs: 0, message: `unhandled kind "${hook.type}"` };
  }
}
