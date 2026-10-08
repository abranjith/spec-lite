/**
 * Shipped builtin hooks — native TypeScript, executed in-process.
 *
 * These are the CLI's answer to "maintain a Touched Files list by hand":
 * `capture-baseline` snapshots HEAD and existing dirt at `*.pre`;
 * `capture-changeset` diffs against that baseline at `*.post` and merges the
 * result into `changeset.json`. Neither is a shipped shell script — this is a
 * Windows-primary project, and `.sh` builtins would break on day one.
 *
 * `changeset-from-pr` ships but is NOT in `BUILTIN_HOOKS` — it is opt-in only,
 * for PR-first teams that want `gh pr diff --name-only` instead of a local
 * git baseline.
 */
import path from "node:path";
import fs from "fs-extra";
import type { HookDefinition, HookPayload, HookResult } from "../types.js";
import { captureBaseline, captureChangeset } from "../changeset.js";
import { changesetFromPr } from "./changeset-from-pr.js";
import { prepareWorktree, commitProgress } from "./git-workflow.js";
import { createPullRequest } from "./pull-request.js";

export interface BuiltinContext {
  root: string;
  payload: HookPayload;
  hook?: HookDefinition;
}

export interface BuiltinOutcome { message: string; worktree?: import("../types.js").WorktreeInfo }
export type BuiltinHandler = (ctx: BuiltinContext) => Promise<BuiltinOutcome>;

/**
 * Changeset capture needs somewhere to write changeset.json — a feature
 * directory. Fix is frequently invoked without one (an ad-hoc bug fix with no
 * tracked feature), so a missing `--feature` is a graceful no-op, not a
 * failure: returning undefined here, rather than throwing, is what keeps
 * feature-less Fix runs from surfacing a spurious hook failure on every call.
 */
async function optionalFeatureDir(ctx: BuiltinContext): Promise<string | undefined> {
  const dir = ctx.payload.feature?.dir;
  if (!dir) return undefined;
  const abs = path.join(ctx.root, dir);
  await fs.ensureDir(abs);
  return dir;
}

export const BUILTIN_HANDLERS: Record<string, BuiltinHandler> = {
  "prepare-worktree": prepareWorktree,
  "commit-progress": commitProgress,
  "create-pull-request": createPullRequest,
  "capture-baseline": async (ctx) => {
    const dir = await optionalFeatureDir(ctx);
    if (!dir) return { message: "no --feature given; changeset capture skipped" };

    const worktree = ctx.payload.worktree;
    const doc = await captureBaseline(ctx.root, dir, {
      featureId: ctx.payload.feature?.id,
      event: ctx.payload.event,
      // Set when prepare-worktree ran first: a new workflow starts a new changeset.
      workflow: worktree ? `${worktree.branch}@${worktree.initialHead}` : undefined,
    });
    return {
      message:
        doc.vcs === "git"
          ? `baseline ${doc.baseline?.sha.slice(0, 7)} captured (${doc.baseline?.dirtyAtBaseline.length ?? 0} pre-dirty)`
          : "not a git repository — changeset capture disabled, falling back to manual tracking",
    };
  },

  "capture-changeset": async (ctx) => {
    const dir = await optionalFeatureDir(ctx);
    if (!dir) return { message: "no --feature given; changeset capture skipped" };

    const doc = await captureChangeset(ctx.root, dir, {
      event: ctx.payload.event,
      role: ctx.payload.role,
      task: ctx.payload.task?.id,
    });
    return {
      message:
        doc.vcs === "git" && doc.baseline
          ? `${doc.files.length} file(s) in changeset (${doc.excluded.length} excluded)`
          : `changeset not captured — ${doc.noBaselineReason ?? "no baseline available"}`,
    };
  },

  "changeset-from-pr": async (ctx) => {
    const dir = await optionalFeatureDir(ctx);
    if (!dir) return { message: "no --feature given; changeset capture skipped" };
    const doc = await changesetFromPr(ctx.root, dir, { event: ctx.payload.event, role: ctx.payload.role });
    return { message: `${doc.files.length} file(s) from gh pr diff` };
  },
};

/** Run one builtin by handler id, translating thrown errors into a HookResult-shaped failure. */
export async function runBuiltin(
  handlerId: string,
  ctx: BuiltinContext
): Promise<BuiltinOutcome & { ok: boolean }> {
  const handler = BUILTIN_HANDLERS[handlerId];
  if (!handler) return { ok: false, message: `unknown builtin "${handlerId}"` };
  try {
    return { ok: true, ...await handler(ctx) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The shipped registry layer. Resolution order in registry.ts is
 * builtins -> global -> project, merged by `name`, so a project hook named
 * "capture-changeset" replaces this entry wholesale.
 */
export const BUILTIN_HOOKS: HookDefinition[] = [
  {
    // implement.task.pre re-announces the worktree before every task, so a
    // missed handoff is caught before edits land in the wrong checkout.
    name: "prepare-worktree", events: ["implement.pre", "implement.task.pre", "fix.pre"], type: "builtin", builtin: "prepare-worktree",
    description: "Create or resume the workflow's branch and worktree before code changes.", enabled: false, order: 0, onFailure: "abort", timeoutMs: 300000,
  },
  {
    name: "capture-baseline",
    events: ["implement.pre", "implement.task.pre", "fix.pre"],
    type: "builtin",
    builtin: "capture-baseline",
    description: "Records HEAD and pre-existing dirt so later diffs are scoped to this run.",
    enabled: true,
    order: 10,
    onFailure: "warn",
  },
  {
    name: "capture-changeset",
    events: ["implement.post", "implement.task.post", "fix.post"],
    type: "builtin",
    builtin: "capture-changeset",
    description: "Diffs against the captured baseline and merges the result into changeset.json.",
    enabled: true,
    order: 10,
    onFailure: "warn",
  },
  {
    name: "commit-progress", events: ["implement.task.post", "implement.post", "fix.post"], type: "builtin", builtin: "commit-progress",
    description: "Commit verified tasks; commit and push completed implementations and fixes.", enabled: false, order: 200, onFailure: "abort", timeoutMs: 120000,
  },
  {
    name: "create-pull-request", events: ["implement.post", "fix.post"], type: "builtin", builtin: "create-pull-request",
    description: "Create or reuse the workflow's PR against the configured target branch.", enabled: false, order: 300, onFailure: "abort", timeoutMs: 120000,
  },
];
