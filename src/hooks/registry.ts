/**
 * Load and merge the hook registry: builtins -> global (~/.spec-lite/hooks.json)
 * -> project (.spec-lite/hooks.json). Later layers REPLACE the whole entry for
 * a given `name` (not deep-merge) — predictable, and it mirrors the
 * "replace, don't append" rule already used by feature-summary.md. `enabled:
 * false` disables a builtin without redefining it.
 */
import fs from "fs-extra";
import Ajv2020 from "ajv/dist/2020.js";
import { BUILTIN_HOOKS } from "./builtins/index.js";
import { hooksJsonPath, globalHooksJsonPath } from "./workspace.js";
import { buildHooksSchema } from "./schema.js";
import { resolvePattern, getEvent, type EventDefinition } from "./events.js";
import { validateTemplate } from "./interpolation.js";
import type { HookDefinition, HookRegistryFile, HookSource, ResolvedHook } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(buildHooksSchema());

export interface RegistryIssue {
  level: "error" | "warning";
  message: string;
  hook?: string;
}

export interface LoadedRegistry {
  hooks: ResolvedHook[];
  issues: RegistryIssue[];
}

async function readRegistryFile(file: string, source: HookSource): Promise<{
  hooks: HookDefinition[];
  issues: RegistryIssue[];
}> {
  if (!(await fs.pathExists(file))) return { hooks: [], issues: [] };

  let raw: unknown;
  try {
    raw = await fs.readJson(file);
  } catch (err) {
    return {
      hooks: [],
      issues: [{ level: "error", message: `${file}: invalid JSON — ${(err as Error).message}` }],
    };
  }

  if (!validateSchema(raw)) {
    const issues: RegistryIssue[] = (validateSchema.errors ?? []).map((e) => ({
      level: "error" as const,
      message: `${file}${e.instancePath || ""}: ${e.message}`,
    }));
    return { hooks: [], issues };
  }

  const doc = raw as HookRegistryFile;
  return { hooks: doc.hooks, issues: [] };
}

/** The templated string fields a hook may carry, per kind. */
function templateFields(hook: HookDefinition): string[] {
  const fields: (string | undefined)[] = [hook.run, hook.url, hook.bodyTemplate, hook.args, hook.cwd];
  if (hook.env) fields.push(...Object.values(hook.env));
  if (hook.headers) fields.push(...Object.values(hook.headers));
  return fields.filter((f): f is string => typeof f === "string");
}

function eventsForHook(hook: HookDefinition): { events: EventDefinition[]; issues: RegistryIssue[] } {
  const events: EventDefinition[] = [];
  const issues: RegistryIssue[] = [];

  for (const pattern of hook.events) {
    const { matched, planned } = resolvePattern(pattern);
    if (matched.length === 0) {
      issues.push({
        level: "error",
        hook: hook.name,
        message: `"${hook.name}" subscribes to "${pattern}", which matches no known event. Run \`spec-lite hook events\`.`,
      });
      continue;
    }
    for (const e of planned) {
      issues.push({
        level: "warning",
        hook: hook.name,
        message: `"${hook.name}" subscribes to "${e.name}", which is declared but not emitted by any role yet.`,
      });
    }
    events.push(...matched);
  }

  return { events, issues };
}

function validateHook(hook: HookDefinition): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const { events, issues: eventIssues } = eventsForHook(hook);
  issues.push(...eventIssues);

  if (events.length === 0) return issues; // already reported above

  for (const field of templateFields(hook)) {
    const d = validateTemplate(field, events, `"${hook.name}"`);
    for (const message of d.errors) issues.push({ level: "error", hook: hook.name, message });
    for (const message of d.warnings) issues.push({ level: "warning", hook: hook.name, message });
  }

  if (hook.type === "builtin") {
    // handler existence is checked at dispatch time in runner.ts, since it
    // only matters if the hook is actually enabled and fires.
  }

  return issues;
}

/** Merge layers by `name`; a later layer replaces the earlier entry wholesale. */
function mergeLayers(
  layers: Array<{ hooks: HookDefinition[]; source: HookSource }>
): ResolvedHook[] {
  const byName = new Map<string, ResolvedHook>();
  const order: string[] = [];

  for (const layer of layers) {
    for (const hook of layer.hooks) {
      if (!byName.has(hook.name)) order.push(hook.name);
      byName.set(hook.name, { ...hook, source: layer.source });
    }
  }

  return order.map((name) => byName.get(name)!);
}

export async function loadRegistry(root: string): Promise<LoadedRegistry> {
  const [global, project] = await Promise.all([
    readRegistryFile(globalHooksJsonPath(), "global"),
    readRegistryFile(hooksJsonPath(root), "project"),
  ]);

  const issues: RegistryIssue[] = [...global.issues, ...project.issues];

  const merged = mergeLayers([
    { hooks: BUILTIN_HOOKS, source: "builtin" },
    { hooks: global.hooks, source: "global" },
    { hooks: project.hooks, source: "project" },
  ]);

  const enabled = merged.filter((h) => h.enabled !== false);

  for (const hook of enabled) issues.push(...validateHook(hook));

  return { hooks: enabled, issues };
}

/** Hooks subscribed to a concrete event name, ordered by `order` then declaration. */
export function hooksForEvent(hooks: ResolvedHook[], eventName: string): ResolvedHook[] {
  const event = getEvent(eventName);
  if (!event) return [];

  return hooks
    .map((hook, index) => ({ hook, index }))
    .filter(({ hook }) => hook.events.some((pattern) => resolvePattern(pattern).matched.some((e) => e.name === eventName)))
    .sort((a, b) => (a.hook.order ?? 100) - (b.hook.order ?? 100) || a.index - b.index)
    .map(({ hook }) => hook);
}
