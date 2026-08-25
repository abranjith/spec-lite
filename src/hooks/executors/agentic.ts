/**
 * "Executor" for `skill` / `agent` / `prompt` hooks. These are never run by
 * the CLI — they are emitted to stdout as a SPEC-LITE-DIRECTIVE line for the
 * calling harness to carry out, and are therefore best-effort. The directive
 * object is the resolved template values, not re-escaped text splicing:
 * fields are interpolated with escape context "none" and the whole object is
 * then JSON.stringify'd once, so quoting is handled exactly once.
 */
import { resolveTemplate, type ResolveContext } from "../interpolation.js";
import type { HookDefinition, HookResult } from "../types.js";

export function emitAgenticDirective(hook: HookDefinition, ctx: ResolveContext): HookResult {
  const resolve = (t: string | undefined) => (t ? resolveTemplate(t, ctx, "none").value : undefined);

  let directiveObj: Record<string, unknown>;
  try {
    directiveObj = {
      hook: hook.name,
      type: hook.type,
      event: ctx.payload.event,
      skill: hook.type === "skill" ? hook.skill : undefined,
      agent: hook.type === "agent" ? hook.agent : undefined,
      prompt: hook.type === "prompt" ? resolve(hook.prompt) : undefined,
      args: resolve(hook.args),
    };
  } catch (err) {
    return {
      name: hook.name, event: ctx.payload.event, kind: hook.type, status: "failed",
      durationMs: 0, message: err instanceof Error ? err.message : String(err),
      contractError: true,
    };
  }

  const directive = `SPEC-LITE-DIRECTIVE ${JSON.stringify(directiveObj)}`;
  return { name: hook.name, event: ctx.payload.event, kind: hook.type, status: "emitted", durationMs: 0, directive };
}
