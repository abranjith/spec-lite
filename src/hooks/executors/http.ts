/**
 * Executor for `http` hooks. Uses Node 22's built-in fetch — no new dependency.
 */
import {
  redactEnvValues,
  resolveTemplate,
  type EscapeContext,
  type ResolveContext,
} from "../interpolation.js";
import type { HookDefinition, HookResult } from "../types.js";

export async function runHttpHook(
  hook: HookDefinition,
  ctx: ResolveContext
): Promise<HookResult> {
  const start = Date.now();
  if (!hook.url) {
    return {
      name: hook.name,
      event: ctx.payload.event,
      kind: "http",
      status: "failed",
      durationMs: 0,
      message: "no `url` configured",
    };
  }

  // The request is consumed here and nowhere else, so its fields may read
  // ${env:...}. Every value used is redacted from the result message, which
  // is printed and written to the audit log; a URL parse error, for one,
  // quotes the whole URL.
  const usedEnv: string[] = [];
  const resolve = (template: string, escape: EscapeContext) => {
    const { value, usedEnvVars } = resolveTemplate(
      template,
      { ...ctx, allowEnv: true },
      escape
    );
    usedEnv.push(...usedEnvVars);
    return value;
  };
  const redact = (text: string) =>
    redactEnvValues(text, usedEnv, ctx.env ?? process.env);

  let url: string;
  let body: string;
  let headers: Record<string, string>;
  try {
    url = resolve(hook.url, "url");
    body = hook.bodyTemplate
      ? resolve(hook.bodyTemplate, "json")
      : JSON.stringify(ctx.payload);
    // Header values are templates too — that is how an Authorization header
    // gets its secret from ${env:...} without the token living in the registry.
    headers = { "Content-Type": "application/json" };
    for (const [name, template] of Object.entries(hook.headers ?? {})) {
      headers[name] = resolve(template, "header");
    }
  } catch (err) {
    return {
      name: hook.name,
      event: ctx.payload.event,
      kind: "http",
      status: "failed",
      durationMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      contractError: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), hook.timeoutMs ?? 30000);

  try {
    const res = await fetch(url, {
      method: hook.method ?? "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    if (res.ok) {
      return {
        name: hook.name,
        event: ctx.payload.event,
        kind: "http",
        status: "ok",
        exitCode: res.status,
        durationMs,
      };
    }
    return {
      name: hook.name,
      event: ctx.payload.event,
      kind: "http",
      status: "failed",
      exitCode: res.status,
      durationMs,
      message: `HTTP ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `timed out after ${hook.timeoutMs ?? 30000}ms`
        : redact(String(err));
    return {
      name: hook.name,
      event: ctx.payload.event,
      kind: "http",
      status: "failed",
      durationMs: Date.now() - start,
      message,
    };
  }
}
