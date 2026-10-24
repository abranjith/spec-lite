/**
 * Load and merge the hook registry: builtins -> global (~/.spec-lite/hooks.json)
 * -> project (.spec-lite/hooks.json). Later layers REPLACE the whole entry for
 * a given `name` (not deep-merge) — predictable, and it mirrors the
 * "replace, don't append" rule already used by feature-summary.md. `enabled:
 * false` disables a builtin without redefining it.
 */
import path from "node:path";
import fs from "fs-extra";
import Ajv2020 from "ajv/dist/2020.js";
import { BUILTIN_HOOKS } from "./builtins/index.js";
import { GIT_WORKFLOW_HOOKS } from "./builtins/git-workflow.js";
import {
  BUILTIN_REQUIRES,
  validateBuiltinOptions,
} from "./builtins/options.js";
import { hooksJsonPath, globalHooksJsonPath } from "./workspace.js";
import { buildHooksSchema } from "./schema.js";
import { resolvePattern, getEvent, type EventDefinition } from "./events.js";
import { validateTemplate } from "./interpolation.js";
import { isHookDefinition, SETTINGS_FIELDS } from "./types.js";
import type {
  HookDefinition,
  HookEntry,
  HookRegistryFile,
  HookSource,
  ResolvedHook,
} from "./types.js";
import {
  flowHookErrors,
  flowOrderErrors,
  effectiveOrder,
} from "./control/validation.js";

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

async function readRegistryFile(
  file: string,
  _source: HookSource
): Promise<{
  hooks: HookEntry[];
  issues: RegistryIssue[];
}> {
  if (!(await fs.pathExists(file))) return { hooks: [], issues: [] };

  let raw: unknown;
  try {
    raw = await fs.readJson(file);
  } catch (err) {
    return {
      hooks: [],
      issues: [
        {
          level: "error",
          message: `${file}: invalid JSON — ${(err as Error).message}`,
        },
      ],
    };
  }

  if (!validateSchema(raw)) {
    // An `if`/`then` failure only restates the error inside it, and the
    // key-level errors do not say which key is wrong.
    // An inner property-name error only restates its propertyNames error.
    const issues: RegistryIssue[] = (validateSchema.errors ?? [])
      .filter(
        (e) =>
          e.keyword !== "if" &&
          !(e.propertyName !== undefined && e.keyword !== "propertyNames")
      )
      .map((e) => {
        const params = e.params as {
          additionalProperty?: string;
          propertyName?: string;
        };
        const key = params.additionalProperty ?? params.propertyName;
        const hint =
          e.keyword === "propertyNames"
            ? ` ("${key}"): an entry without "type" configures an existing hook and may set only ${SETTINGS_FIELDS.filter((field) => field !== "name").join(", ")}`
            : key
              ? ` ("${key}")`
              : "";
        return {
          level: "error" as const,
          message: `${file}${e.instancePath || ""}: ${e.message}${hint}`,
        };
      });
    return { hooks: [], issues };
  }

  const doc = raw as HookRegistryFile;
  return { hooks: doc.hooks, issues: [] };
}

/** Where a hook that is not a builtin takes its settings, for error messages. */
function settingsFields(hook: HookDefinition): string {
  switch (hook.type) {
    case "command":
    case "script":
      return "`run` arguments or `env`";
    case "http":
      return "`url`, `headers` or `bodyTemplate`";
    case "prompt":
      return "the `prompt` text";
    default:
      return "`args`";
  }
}

/** The templated string fields a hook may carry, per kind. */
export function templateFields(hook: HookDefinition): string[] {
  const fields: (string | undefined)[] = [
    hook.run,
    hook.url,
    hook.bodyTemplate,
    hook.args,
    hook.prompt,
    hook.cwd,
  ];
  if (hook.env) fields.push(...Object.values(hook.env));
  if (hook.headers) fields.push(...Object.values(hook.headers));
  return fields.filter((f): f is string => typeof f === "string");
}

function eventsForHook(hook: HookDefinition): {
  events: EventDefinition[];
  issues: RegistryIssue[];
} {
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
  issues.push(
    ...flowHookErrors(hook).map((message) => ({
      level: "error" as const,
      hook: hook.name,
      message,
    }))
  );
  const { events, issues: eventIssues } = eventsForHook(hook);
  issues.push(...eventIssues);

  if (events.length === 0) return issues; // already reported above

  for (const field of templateFields(hook)) {
    const d = validateTemplate(field, events, `"${hook.name}"`, hook.requires);
    for (const message of d.errors)
      issues.push({ level: "error", hook: hook.name, message });
    for (const message of d.warnings)
      issues.push({ level: "warning", hook: hook.name, message });
  }

  // Options are checked against what the builtin declares; any other kind
  // of hook takes none. A builtin's handler existence is checked at dispatch
  // time in runner.ts, since it only matters if the hook fires.
  if (hook.type === "builtin") {
    const report = validateBuiltinOptions(
      hook.builtin ?? hook.name,
      hook.options
    );
    for (const message of report.errors)
      issues.push({
        level: "error",
        hook: hook.name,
        message: `${hook.name}: ${message}`,
      });
    for (const message of report.warnings)
      issues.push({
        level: "warning",
        hook: hook.name,
        message: `${hook.name}: ${message}`,
      });
  } else if (hook.options !== undefined) {
    issues.push({
      level: "error",
      hook: hook.name,
      message: `${hook.name}: only builtin hooks take options. Pass settings to a ${hook.type} hook through ${settingsFields(hook)} instead.`,
    });
  }
  return issues;
}

/** Events each Git workflow builtin must handle for the chain to hold together. */
const GIT_WORKFLOW_EVENTS: Record<
  (typeof GIT_WORKFLOW_HOOKS)[number],
  string[]
> = {
  "prepare-worktree": ["implement.pre", "implement.task.pre", "fix.pre"],
  "commit-progress": ["implement.task.post", "implement.post", "fix.post"],
  "create-pull-request": ["implement.post", "fix.post"],
};

const handlerOf = (hook: HookDefinition) =>
  hook.type === "builtin" ? (hook.builtin ?? hook.name) : undefined;
const subscribes = (hook: HookDefinition, event: string) =>
  hook.events.some((pattern) =>
    resolvePattern(pattern).matched.some((e) => e.name === event)
  );

/** A builtin that depends on another (builtins/options.ts) needs it enabled too. */
function gitWorkflowDependencies(enabled: ResolvedHook[]): RegistryIssue[] {
  const has = (id: string) => enabled.some((hook) => handlerOf(hook) === id);
  const issues: RegistryIssue[] = [];
  for (const [id, requirement] of Object.entries(BUILTIN_REQUIRES)) {
    if (has(id) && !has(requirement.hook)) {
      issues.push({
        level: "error",
        hook: id,
        message: `${id} needs ${requirement.hook}, which ${requirement.why}. Enable both: spec-lite hook enable ${requirement.hook} ${id}`,
      });
    }
  }
  return issues;
}

/**
 * Whole-chain rules for the Git workflow builtins. Overrides replace entire
 * entries, so a hand-written entry could otherwise drop an event, an abort
 * policy, or its place in the order without anything failing loudly.
 */
function validateGitWorkflow(enabled: ResolvedHook[]): RegistryIssue[] {
  const git = new Map(
    GIT_WORKFLOW_HOOKS.map((id) => [
      id,
      enabled.find((hook) => handlerOf(hook) === id),
    ])
  );
  if (![...git.values()].some(Boolean)) return [];
  const issues = gitWorkflowDependencies(enabled);
  const error = (hook: HookDefinition, message: string) =>
    issues.push({ level: "error", hook: hook.name, message });

  for (const [id, hook] of git) {
    if (!hook) continue;
    const missing = GIT_WORKFLOW_EVENTS[id].filter(
      (event) => !subscribes(hook, event)
    );
    if (missing.length)
      error(hook, `${hook.name} must subscribe to ${missing.join(", ")}.`);
    if (hook.onFailure !== "abort")
      error(
        hook,
        `${hook.name} must use "onFailure": "abort", so a failed step stops the workflow.`
      );
  }

  const prepare = git.get("prepare-worktree");
  const commit = git.get("commit-progress");
  const pr = git.get("create-pull-request");
  const position = (event: string, hook: ResolvedHook) =>
    hooksForEvent(enabled, event).indexOf(hook);
  if (prepare) {
    for (const event of GIT_WORKFLOW_EVENTS["prepare-worktree"]) {
      const first = hooksForEvent(enabled, event)[0];
      if (first && first !== prepare) {
        error(
          prepare,
          `${prepare.name} must run first on ${event} so later hooks run in the worktree, but ${first.name} (order ${first.order ?? 100}) runs before it.`
        );
      }
    }
  }
  if (commit) {
    const capture = enabled.find(
      (hook) => handlerOf(hook) === "capture-changeset"
    );
    for (const event of GIT_WORKFLOW_EVENTS["commit-progress"]) {
      if (
        capture &&
        subscribes(capture, event) &&
        position(event, capture) > position(event, commit)
      ) {
        error(
          commit,
          `${commit.name} must run after ${capture.name} on ${event}, so the commit includes changeset.json.`
        );
      }
    }
  }
  if (commit && pr) {
    for (const event of GIT_WORKFLOW_EVENTS["create-pull-request"]) {
      if (position(event, pr) < position(event, commit))
        error(
          pr,
          `${pr.name} must run after ${commit.name} on ${event}, which pushes the branch.`
        );
    }
  }
  return issues;
}

/**
 * Merge layers by `name`. An entry with `type` replaces the earlier entry
 * wholesale. An entry without one carries only settings, applied on top of
 * the definition an earlier layer provides; its `options` replace the earlier
 * options as a whole.
 */
function mergeLayers(
  layers: Array<{ hooks: HookEntry[]; source: HookSource }>
): { hooks: ResolvedHook[]; issues: RegistryIssue[] } {
  const byName = new Map<string, ResolvedHook>();
  const order: string[] = [];
  const issues: RegistryIssue[] = [];

  for (const layer of layers) {
    for (const entry of layer.hooks) {
      if (isHookDefinition(entry)) {
        if (!byName.has(entry.name)) order.push(entry.name);
        byName.set(entry.name, { ...entry, source: layer.source });
        continue;
      }
      const base = byName.get(entry.name);
      if (!base) {
        issues.push({
          level: "error",
          hook: entry.name,
          message: `"${entry.name}" in the ${layer.source} registry has no "type", so it configures an existing hook, but no hook with that name exists. Add "type" and "events" to define a new hook.`,
        });
        continue;
      }
      byName.set(entry.name, { ...base, ...entry, source: layer.source });
    }
  }

  return { hooks: order.map((name) => byName.get(name)!), issues };
}

export interface LoadRegistryOptions {
  /** Include disabled definitions for inspection and state changes, never dispatch. */
  includeDisabled?: boolean;
  /** Global resolution excludes project overrides. Defaults to project. */
  scope?: "global" | "project";
  /** Temporary suppressions do not validate inactive hook contracts. */
  skip?: string[];
}

export function hookIsSkipped(hook: HookDefinition, skip: string[]): boolean {
  return (
    skip.includes("*") ||
    skip.includes(hook.name) ||
    (hook.type === "builtin" && skip.includes(hook.builtin ?? hook.name))
  );
}

export async function loadRegistry(
  root: string,
  options: LoadRegistryOptions = {}
): Promise<LoadedRegistry> {
  const [global, project] = await Promise.all([
    readRegistryFile(globalHooksJsonPath(), "global"),
    options.scope === "global"
      ? Promise.resolve({ hooks: [], issues: [] })
      : readRegistryFile(hooksJsonPath(root), "project"),
  ]);

  const { hooks: merged, issues: mergeIssues } = mergeLayers([
    { hooks: BUILTIN_HOOKS, source: "builtin" },
    { hooks: global.hooks, source: "global" },
    { hooks: project.hooks, source: "project" },
  ]);
  const issues: RegistryIssue[] = [
    ...global.issues,
    ...project.issues,
    ...mergeIssues,
  ];

  const enabled = merged.filter((h) => h.enabled !== false);

  for (const hook of enabled)
    if (!hookIsSkipped(hook, options.skip ?? []))
      issues.push(...validateHook(hook));
  issues.push(...validateGitWorkflow(enabled));
  // Role runs are tracked, and a tracked event allows one hand-off or checkpoint.
  issues.push(
    ...flowOrderErrors(
      enabled.filter((h) => !hookIsSkipped(h, options.skip ?? []))
    ).map((message) => ({ level: "error" as const, message }))
  );

  return { hooks: options.includeDisabled ? merged : enabled, issues };
}

/** Change one hook's enabled state; see setHooksEnabled. */
export async function setHookEnabled(
  root: string,
  name: string,
  enabled: boolean,
  scope: "global" | "project" = "project"
): Promise<string> {
  return setHooksEnabled(root, [name], enabled, scope);
}

/**
 * Change several hooks at once, validating the result as a whole: the Git
 * workflow builtins depend on each other, so enabling them one at a time
 * would fail on the first.
 */
export async function setHooksEnabled(
  root: string,
  names: string[],
  enabled: boolean,
  scope: "global" | "project" = "project"
): Promise<string> {
  const { hooks, issues } = await loadRegistry(root, {
    includeDisabled: true,
    scope,
  });
  // Never overwrite a malformed file. Semantic errors on enabled hooks may
  // still be repaired by disabling them.
  const fileErrors = issues.filter(
    (issue) => issue.level === "error" && !issue.hook
  );
  if (fileErrors.length)
    throw new Error(fileErrors.map((issue) => issue.message).join("\n"));

  const targets = names.map((name) => {
    const hook = hooks.find((entry) => entry.name === name);
    if (!hook)
      throw new Error(
        `No hook named "${name}". Run \`spec-lite hook list --all\` to see available hooks.`
      );
    return hook;
  });
  const next = hooks.map((hook) =>
    names.includes(hook.name) ? { ...hook, enabled } : hook
  );
  const active = (list: ResolvedHook[]) =>
    list.filter((hook) => hook.enabled !== false);
  // Disabling must not strand a hook that depends on the disabled one;
  // enabling must leave a valid workflow. Pre-existing problems are left to
  // `hook validate`, so they never block an unrelated change.
  const chain = (list: ResolvedHook[]) =>
    (enabled
      ? validateGitWorkflow(active(list))
      : gitWorkflowDependencies(active(list))
    )
      .filter((issue) => issue.level === "error")
      .map((issue) => issue.message);
  const before = new Set(chain(hooks));
  const errors = [
    ...(enabled
      ? targets
          .flatMap((hook) => validateHook(hook))
          .filter((issue) => issue.level === "error")
          .map((issue) => issue.message)
      : []),
    ...chain(next).filter((message) => !before.has(message)),
  ];
  if (errors.length) throw new Error(errors.join("\n"));

  const file = scope === "global" ? globalHooksJsonPath() : hooksJsonPath(root);
  const doc: HookRegistryFile = (await fs.pathExists(file))
    ? await fs.readJson(file)
    : { version: 1, hooks: [] };
  for (const hook of targets) {
    const entries = doc.hooks.filter((entry) => entry.name === hook.name);
    const index = doc.hooks.findIndex((entry) => entry.name === hook.name);
    if (index === -1) {
      // Settings only: the definition stays with the layer that provides it,
      // so a builtin keeps receiving updates.
      doc.hooks.push({ name: hook.name, enabled });
      continue;
    }
    // Duplicate names already resolve to the last entry; collapse them when
    // changing state so an earlier duplicate cannot undo the requested state.
    const effective = { ...entries[entries.length - 1], enabled };
    doc.hooks = doc.hooks.filter((entry) => entry.name !== hook.name);
    doc.hooks.splice(index, 0, effective);
  }
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, doc, { spaces: 2 });
  return file;
}

/** Hooks subscribed to a concrete event name, ordered by `order` then declaration. */
export function hooksForEvent(
  hooks: ResolvedHook[],
  eventName: string
): ResolvedHook[] {
  const event = getEvent(eventName);
  if (!event) return [];

  return hooks
    .map((hook, index) => ({ hook, index }))
    .filter(({ hook }) =>
      hook.events.some((pattern) =>
        resolvePattern(pattern).matched.some((e) => e.name === eventName)
      )
    )
    .sort(
      (a, b) =>
        effectiveOrder(a.hook) - effectiveOrder(b.hook) || a.index - b.index
    )
    .map(({ hook }) => hook);
}
