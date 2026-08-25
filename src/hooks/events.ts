/**
 * The spec-lite event catalog.
 *
 * Names are dotted and hierarchical (`implement.task.post`). Dotted naming
 * avoids a real collision that flat hyphenation creates — `post-feature` is
 * ambiguous between the *Feature role* and a *per-feature iteration* — and it
 * gives wildcards a meaningful boundary.
 *
 * The catalog declares every event spec-lite will ever emit, each flagged
 * `emitted` or `planned`. Only the core pipeline is wired in v1; the rest are
 * declared so that subscribing to them validates with a warning rather than a
 * hard "unknown event" error. That avoids a cliff where users hit failures on
 * roles that simply are not wired yet.
 *
 * Each event also declares which variable groups it **guarantees**. That is
 * what lets `spec-lite hook validate` reject `${task.id}` on `implement.post`
 * in CI instead of at fire time. See ./interpolation.ts.
 */

import type { HookPhase } from "./types.js";

/** `emitted` = a role calls `hook run` for this today. `planned` = declared, not yet wired. */
export type EventStatus = "emitted" | "planned";

/**
 * Groups of interpolation variables an event can guarantee.
 * The base group (event, role, phase, runId, timestamp, cwd, provider,
 * payload, env) is implicit and always available.
 */
export type VarGroup = "feature" | "task" | "changes" | "verdict" | "summary";

export interface EventDefinition {
  name: string;
  /** The agent/skill that emits it, in kebab form. `*` for cross-cutting events. */
  role: string;
  phase: HookPhase;
  status: EventStatus;
  /**
   * Variable groups this event is guaranteed to carry. A group absent here may
   * still be present at runtime (a fix often does map to a feature), but a
   * template relying on it must supply a `${name:-default}` fallback.
   */
  provides: VarGroup[];
  description: string;
}

const E = (
  name: string,
  role: string,
  phase: HookPhase,
  status: EventStatus,
  provides: VarGroup[],
  description: string
): EventDefinition => ({ name, role, phase, status, provides, description });

/**
 * The complete catalog. Order is presentation order for `spec-lite hook events`.
 */
export const EVENT_CATALOG: readonly EventDefinition[] = [
  // --- Discovery -----------------------------------------------------------
  E("brainstorm.pre", "brainstorm", "pre", "emitted", [],
    "Before a brainstorm session begins."),
  E("brainstorm.post", "brainstorm", "post", "emitted", ["summary"],
    "After .spec-lite/brainstorm.md is written."),
  E("plan.pre", "plan", "pre", "emitted", [],
    "Before plan authoring begins."),
  E("plan.post", "plan", "post", "emitted", ["summary"],
    "After the plan file and its FEAT-### rows are written."),
  E("plan-feature.pre", "plan-feature", "pre", "emitted", [],
    "Before a standalone feature spec is authored."),
  E("plan-feature.post", "plan-feature", "post", "emitted", ["feature", "summary"],
    "After a standalone feature spec is written."),
  E("architect.pre", "architect", "pre", "planned", [],
    "Before an architecture consultation begins."),
  E("architect.post", "architect", "post", "planned", ["summary"],
    "After the architecture document is written."),
  E("plan-critic.pre", "plan-critic", "pre", "planned", [],
    "Before a plan is pressure-tested."),
  E("plan-critic.post", "plan-critic", "post", "planned", ["summary"],
    "After the plan critique is written."),
  E("build-data-model.pre", "build-data-model", "pre", "planned", [],
    "Before schema design begins."),
  E("build-data-model.post", "build-data-model", "post", "planned", ["summary"],
    "After .spec-lite/data_model.md is written."),

  // --- Specification -------------------------------------------------------
  E("feature.pre", "feature", "pre", "emitted", [],
    "Before feature breakdown begins."),
  E("feature.post", "feature", "post", "emitted", ["summary"],
    "After the Feature skill finishes (all modes)."),
  E("feature.spec.post", "feature", "post", "emitted", ["feature", "summary"],
    "Once per FEAT-### spec written, including each Plan Mode fan-out subagent."),

  // --- Implementation ------------------------------------------------------
  E("implement.pre", "implement", "pre", "emitted", ["feature"],
    "Before implementation begins. Built-in changeset baseline is captured here."),
  E("implement.post", "implement", "post", "emitted", ["feature", "changes", "summary"],
    "After implementation is finalized. Built-in changeset capture runs here."),
  E("implement.task.pre", "implement", "pre", "emitted", ["feature", "task"],
    "Before each TASK-### begins."),
  E("implement.task.post", "implement", "post", "emitted", ["feature", "task", "changes"],
    "After each TASK-### is verified complete."),
  E("implement.feature.post", "implement", "post", "emitted", ["feature", "changes", "summary"],
    "Once per FEAT-### completed during Plan Mode fan-out."),

  // --- Validation ----------------------------------------------------------
  E("review.pre", "review", "pre", "emitted", [],
    "After scope resolution, before analysis."),
  E("review.post", "review", "post", "emitted", ["summary"],
    "After the review report is written."),
  E("review.verdict", "review", "signal", "emitted", ["verdict", "summary"],
    "Carries the verdict and finding counts — the routing signal for remediation."),
  E("fix.pre", "fix", "pre", "emitted", [],
    "Before diagnosis begins. Built-in changeset baseline is captured here."),
  E("fix.post", "fix", "post", "emitted", ["changes", "summary"],
    "After the fix and its regression test are verified. Built-in changeset capture runs here."),
  E("write-unit-tests.pre", "write-unit-tests", "pre", "planned", [],
    "Before unit-test generation."),
  E("write-unit-tests.post", "write-unit-tests", "post", "planned", ["summary"],
    "After unit tests are written."),
  E("write-integration-tests.pre", "write-integration-tests", "pre", "planned", [],
    "Before integration-test generation."),
  E("write-integration-tests.post", "write-integration-tests", "post", "planned", ["summary"],
    "After integration tests are written."),

  // --- Delivery ------------------------------------------------------------
  E("document.pre", "document", "pre", "planned", [],
    "Before documentation orchestration begins."),
  E("document.post", "document", "post", "planned", ["summary"],
    "After the configured doc set is written."),
  E("document-design.post", "document-design", "post", "planned", ["summary"],
    "After architecture.md is written."),
  E("document-feature.post", "document-feature", "post", "planned", ["feature", "summary"],
    "After one feature doc is written."),
  E("document-usage.post", "document-usage", "post", "planned", ["summary"],
    "After quickstart/usage docs are written."),
  E("document-readme.post", "document-readme", "post", "planned", ["summary"],
    "After README.md is written."),
  E("devops.pre", "devops", "pre", "planned", [],
    "Before infrastructure artifacts are generated."),
  E("devops.post", "devops", "post", "planned", ["changes", "summary"],
    "After infrastructure artifacts are generated."),

  // --- Cross-cutting -------------------------------------------------------
  E("memorize.post", "memorize", "post", "planned", ["summary"],
    "After .spec-lite/memory.md is updated."),
  E("todo.post", "todo", "post", "planned", ["summary"],
    "After a backlog item is appended."),
  E("tool-help.post", "tool-help", "post", "planned", ["summary"],
    "After a project tool is created or edited."),
  E("yolo.pre", "yolo", "pre", "planned", [],
    "Before an autonomous run starts."),
  E("yolo.post", "yolo", "post", "planned", ["summary"],
    "After an autonomous run completes."),
  E("yolo.phase.post", "yolo", "post", "planned", ["summary"],
    "After each YOLO phase."),
  E("hook.error", "*", "signal", "emitted", ["summary"],
    "A hook failed. Lets you route hook failures somewhere visible."),
];

const BY_NAME = new Map(EVENT_CATALOG.map((e) => [e.name, e]));

/** Look up an event definition, or undefined if the name is not in the catalog. */
export function getEvent(name: string): EventDefinition | undefined {
  return BY_NAME.get(name);
}

/** Every event name in the catalog, emitted and planned alike. */
export function allEventNames(): string[] {
  return EVENT_CATALOG.map((e) => e.name);
}

/** Events a role actually emits today. */
export function emittedEventNames(): string[] {
  return EVENT_CATALOG.filter((e) => e.status === "emitted").map((e) => e.name);
}

/**
 * Match an event name against a subscription pattern.
 *
 * `*` matches one or more whole segments, so `implement.*` matches both
 * `implement.post` and `implement.task.post`, and `*.post` matches any event
 * ending in `.post`. A bare `*` matches everything.
 */
export function matchesEventPattern(pattern: string, eventName: string): boolean {
  if (pattern === eventName) return true;
  if (!pattern.includes("*")) return false;

  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+");

  return new RegExp(`^${source}$`).test(eventName);
}

/**
 * Validate a subscription pattern against the catalog.
 *
 * Returns the concrete events it resolves to, plus any that are declared but
 * not yet emitted — the caller surfaces those as a warning, not an error.
 */
export function resolvePattern(pattern: string): {
  matched: EventDefinition[];
  planned: EventDefinition[];
} {
  const matched = EVENT_CATALOG.filter((e) => matchesEventPattern(pattern, e.name));
  return { matched, planned: matched.filter((e) => e.status === "planned") };
}
