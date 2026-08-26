/**
 * Resolve what a hook WOULD do, without doing it — used by `--dry-run`.
 * Reuses each executor's own escape context so the preview matches reality,
 * then redacts any ${env:...} values before returning.
 */
import { resolveTemplate, redactEnvValues, shellEscapeContext } from "./interpolation.js";
import type { HookDefinition } from "./types.js";
import type { ResolveContext } from "./interpolation.js";

export function previewHook(hook: HookDefinition, ctx: ResolveContext): string {
  const usedEnv: string[] = [];
  const resolve = (template: string, escape: Parameters<typeof resolveTemplate>[2]) => {
    const { value, usedEnvVars } = resolveTemplate(template, ctx, escape);
    usedEnv.push(...usedEnvVars);
    return value;
  };

  let text: string;
  try {
    switch (hook.type) {
      case "command":
      case "script":
        text = hook.run ? resolve(hook.run, shellEscapeContext(hook.shell)) : "(no `run` configured)";
        break;
      case "http": {
        if (!hook.url) {
          text = "(no `url` configured)";
          break;
        }
        const lines = [`${hook.method ?? "POST"} ${resolve(hook.url, "url")}`];
        for (const [name, template] of Object.entries(hook.headers ?? {})) {
          lines.push(`${name}: ${resolve(template, "header")}`);
        }
        lines.push(hook.bodyTemplate ? resolve(hook.bodyTemplate, "json") : JSON.stringify(ctx.payload));
        text = lines.join("\n");
        break;
      }
      case "builtin":
        text = `builtin:${hook.builtin ?? hook.name}`;
        break;
      case "skill":
        text = `invoke skill "${hook.skill}"${hook.args ? ` with args: ${resolve(hook.args, "none")}` : ""}`;
        break;
      case "agent":
        text = `invoke agent "${hook.agent}"${hook.args ? ` with args: ${resolve(hook.args, "none")}` : ""}`;
        break;
      case "prompt":
        text = hook.prompt ? resolve(hook.prompt, "none") : "(no `prompt` configured)";
        break;
      default:
        text = `(unhandled kind "${hook.type}")`;
    }
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }

  return redactEnvValues(text, usedEnv);
}
