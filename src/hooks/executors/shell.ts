/**
 * Executor for `command` and `script` hooks. Both kinds run the same way —
 * the kind is documentation of intent (a `script` hook typically names a
 * checked-in file; a `command` hook is usually a one-liner) — so one
 * implementation covers both.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveTemplate, shellEscapeContext, type ResolveContext } from "../interpolation.js";
import type { HookDefinition, HookResult } from "../types.js";

/**
 * Resolve the PowerShell executable actually present on this machine.
 *
 * `pwsh` (PowerShell 7+) is preferred, but a large share of Windows installs
 * only ship Windows PowerShell 5.1 as `powershell.exe`. Hard-coding `pwsh`
 * makes every command/script hook fail with ENOENT on those machines. Both
 * accept `-NoProfile -NonInteractive -Command` and share identical
 * single-quote escaping, so the escape context does not change.
 */
let cachedPowershellBin: string | undefined;

function resolvePowershellBin(): string {
  if (cachedPowershellBin) return cachedPowershellBin;

  const pathValue = process.env.PATH ?? "";
  const exts = (process.env.PATHEXT ?? ".EXE").split(";").filter(Boolean);
  const dirs = pathValue.split(path.delimiter).filter(Boolean);

  for (const candidate of ["pwsh", "powershell"]) {
    for (const dir of dirs) {
      for (const ext of [...exts, ""]) {
        const full = path.join(dir, candidate + ext.toLowerCase());
        const fullUpper = path.join(dir, candidate + ext.toUpperCase());
        if (existsSync(full) || existsSync(fullUpper)) {
          cachedPowershellBin = candidate;
          return candidate;
        }
      }
    }
  }

  cachedPowershellBin = "powershell";
  return cachedPowershellBin;
}

function shellInvocation(shell: string | undefined, resolvedCommand: string): { bin: string; args: string[] } {
  const effective = !shell || shell === "auto" ? (process.platform === "win32" ? "pwsh" : "bash") : shell;
  return effective === "pwsh"
    ? { bin: resolvePowershellBin(), args: ["-NoProfile", "-NonInteractive", "-Command", resolvedCommand] }
    : { bin: "bash", args: ["-c", resolvedCommand] };
}

export async function runShellHook(
  hook: HookDefinition,
  ctx: ResolveContext,
  root: string,
  reentrancyEnv: Record<string, string>
): Promise<HookResult> {
  const start = Date.now();
  if (!hook.run) {
    return { name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed", durationMs: 0, message: "no `run` configured" };
  }

  const escapeCtx = shellEscapeContext(hook.shell);
  let resolvedCommand: string;
  try {
    resolvedCommand = resolveTemplate(hook.run, ctx, escapeCtx).value;
  } catch (err) {
    return {
      name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed",
      durationMs: Date.now() - start, message: err instanceof Error ? err.message : String(err),
      contractError: true,
    };
  }

  const { bin, args } = shellInvocation(hook.shell, resolvedCommand);
  const cwd = hook.cwd ? path.join(root, hook.cwd) : root;

  const env: NodeJS.ProcessEnv = { ...process.env, ...reentrancyEnv };
  env.SPEC_LITE_EVENT = ctx.payload.event;
  if (ctx.payload.feature?.id) env.SPEC_LITE_FEATURE_ID = ctx.payload.feature.id;
  if (ctx.payload.feature?.dir) env.SPEC_LITE_FEATURE_DIR = ctx.payload.feature.dir;
  if (ctx.payload.changes) env.SPEC_LITE_CHANGED_FILES = ctx.payload.changes.files.map((f) => f.path).join("\n");
  if (ctx.payloadFile) env.SPEC_LITE_PAYLOAD_FILE = ctx.payloadFile;
  for (const [k, v] of Object.entries(hook.env ?? {})) {
    env[k] = resolveTemplate(v, ctx, "none").value;
  }

  return new Promise<HookResult>((resolve) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, hook.timeoutMs ?? 30000);

    child.stdin.write(JSON.stringify(ctx.payload));
    child.stdin.end();
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (timedOut) {
        resolve({ name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed", durationMs, message: `timed out after ${hook.timeoutMs ?? 30000}ms` });
        return;
      }
      if (code === 0) {
        resolve({ name: hook.name, event: ctx.payload.event, kind: hook.type, status: "ok", exitCode: 0, durationMs, message: stdout.trim() || undefined });
      } else {
        resolve({ name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed", exitCode: code ?? -1, durationMs, message: stderr.trim() || stdout.trim() || `exit ${code}` });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed", durationMs: Date.now() - start, message: err.message });
    });
  });
}
