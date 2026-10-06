/**
 * Executor for `builtin` hooks — dispatches into the in-process handler map
 * in builtins/index.ts. No subprocess, no shell, no PATH dependency.
 */
import { runBuiltin } from "../builtins/index.js";
import { withProgramEnvironment } from "../builtins/git-workflow.js";
import type { HookDefinition, HookResult } from "../types.js";
import type { ResolveContext } from "../interpolation.js";

export async function runBuiltinHook(hook: HookDefinition, ctx: ResolveContext, root: string, env: NodeJS.ProcessEnv = {}): Promise<HookResult> {
  const start = Date.now();
  const handlerId = hook.builtin ?? hook.name;
  const { ok, message, worktree } = await withProgramEnvironment(env, () => runBuiltin(handlerId, { root, payload: ctx.payload, hook }));
  return {
    name: hook.name,
    event: ctx.payload.event,
    kind: "builtin",
    status: ok ? "ok" : "failed",
    durationMs: Date.now() - start,
    message,
    worktree,
  };
}
