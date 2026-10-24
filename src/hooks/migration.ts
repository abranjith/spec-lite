/**
 * Registry migrations run by `spec-lite update` and `install --global`.
 *
 * 0.5.0 corrected the event catalog: `implement.pre`, `implement.post`,
 * `implement.task.post` and `fix.post` promised `feature` or `changes`
 * variables that Plan, Review, YOLO, Change and feature-less Fix runs never
 * carried. A hook relying on that promise passed `hook validate` and then
 * failed at run time on those runs. Under the corrected catalog the same hook
 * fails validation, and a registry error stops every hook run — Feature Mode
 * included. Adding `requires` keeps such a hook running exactly where it ran
 * before, and skips it where it used to fail.
 */
import fs from "fs-extra";
import { getEvent, resolvePattern } from "./events.js";
import { parseTemplate, describeVars } from "./interpolation.js";
import { templateFields } from "./registry.js";
import { isHookDefinition, type HookDefinition } from "./types.js";

/** Groups each event no longer guarantees after the 0.5.0 correction. */
const WITHDRAWN: Record<string, string[]> = {
  "implement.pre": ["feature"],
  "implement.post": ["feature", "changes"],
  "implement.task.post": ["feature", "changes"],
  "fix.post": ["changes"],
};

const GROUP_OF = new Map(describeVars().map((v) => [v.name, v.group]));

export interface RequiresMigration {
  hook: string;
  added: string[];
}

/** Templates in a checkpoint's options, which `hook validate` checks like any other field. */
function checkpointTemplates(hook: HookDefinition): string[] {
  if (hook.type !== "builtin" || (hook.builtin ?? hook.name) !== "checkpoint")
    return [];
  const options = (hook.options ?? {}) as {
    question?: unknown;
    attach?: unknown;
    inputs?: unknown;
    choices?: Record<string, Record<string, unknown>>;
    rules?: Array<{ if?: Record<string, unknown> }>;
  };
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return [
    options.question,
    ...list(options.attach),
    ...list(options.inputs),
    ...Object.values(options.choices ?? {}).flatMap((choice) => [
      choice?.args,
      choice?.prompt,
      choice?.description,
    ]),
    ...list(options.rules).flatMap((rule) =>
      Object.keys(rule?.if ?? {}).map((field) => `\${${field}}`)
    ),
  ].filter((value): value is string => typeof value === "string");
}

/** Groups this hook needs `requires` for, given the events it subscribes to. */
function groupsToRequire(hook: HookDefinition): string[] {
  const events = hook.events.flatMap(
    (pattern) => resolvePattern(pattern).matched
  );
  const lost = new Set(
    events.flatMap((event) => {
      const provides: string[] = getEvent(event.name)?.provides ?? [];
      return (WITHDRAWN[event.name] ?? []).filter(
        (group) => !provides.includes(group)
      );
    })
  );
  const needed = new Set<string>();
  for (const field of [...templateFields(hook), ...checkpointTemplates(hook)])
    for (const ref of parseTemplate(field)) {
      if (ref.isEnv || ref.fallback !== undefined) continue;
      const group = GROUP_OF.get(ref.name);
      if (group && lost.has(group) && !hook.requires?.includes(group))
        needed.add(group);
    }
  return [...needed];
}

/** Insert `requires` right after `events`, so the entry reads in its usual order. */
function withRequires(entry: HookDefinition, groups: string[]): HookDefinition {
  const requires = [...(entry.requires ?? []), ...groups];
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "requires") continue;
    next[key] = value;
    if (key === "events") next.requires = requires;
  }
  return next as unknown as HookDefinition;
}

/**
 * Add `requires` to every hook in one registry file that uses a `feature` or
 * `changes` variable, without a fallback, on an event that stopped promising
 * it. The file is rewritten only when something changes; a missing or
 * unreadable file is left to `hook validate` to report.
 */
export async function migrateHookRequires(
  file: string
): Promise<RequiresMigration[]> {
  if (!(await fs.pathExists(file))) return [];
  let doc: { hooks?: unknown };
  try {
    doc = await fs.readJson(file);
  } catch {
    return [];
  }
  if (!Array.isArray(doc.hooks)) return [];

  const changes: RequiresMigration[] = [];
  doc.hooks = doc.hooks.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !isHookDefinition(entry as HookDefinition) ||
      !Array.isArray((entry as HookDefinition).events)
    )
      return entry;
    const hook = entry as HookDefinition;
    const added = groupsToRequire(hook);
    if (!added.length) return entry;
    changes.push({ hook: hook.name, added });
    return withRequires(hook, added);
  });

  if (changes.length) await fs.writeJson(file, doc, { spaces: 2 });
  return changes;
}
