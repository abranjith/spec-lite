/**
 * Renders the generated documentation blocks for the hook system.
 *
 * These are the single source of truth for what ends up in
 * docs/features/hooks.md between the marker comments. A test asserts the doc
 * matches what this produces, so the docs cannot drift from the resolver and
 * the event catalog.
 */
import { describeVars } from "./interpolation.js";
import { EVENT_CATALOG } from "./events.js";
import { BUILTIN_HOOKS } from "./builtins/index.js";
import { GIT_WORKFLOW_HOOKS } from "./builtins/git-workflow.js";

export const VARS_TABLE_START = "<!-- hook-vars-table:start -->";
export const VARS_TABLE_END = "<!-- hook-vars-table:end -->";
export const EVENTS_TABLE_START = "<!-- hook-events-table:start -->";
export const EVENTS_TABLE_END = "<!-- hook-events-table:end -->";
export const BUILTIN_HOOKS_START = "<!-- builtin-hooks-json:start -->";
export const BUILTIN_HOOKS_END = "<!-- builtin-hooks-json:end -->";
export const GIT_WORKFLOW_HOOKS_START = "<!-- git-workflow-hooks-json:start -->";
export const GIT_WORKFLOW_HOOKS_END = "<!-- git-workflow-hooks-json:end -->";

const GROUP_LABELS: Record<string, string> = {
  base: "base — every event",
  feature: "feature",
  task: "task",
  changes: "changes",
  verdict: "verdict",
  summary: "summary",
};

/** The `${...}` variable reference table, grouped, in catalog order. */
export function renderVarsTable(): string {
  const rows: string[] = ["| Variable | Group | Meaning | Example |", "|---|---|---|---|"];

  for (const v of describeVars()) {
    const label = GROUP_LABELS[v.group] ?? v.group;
    rows.push(`| \`\${${v.name}}\` | ${label} | ${v.description} | \`${v.example}\` |`);
  }

  rows.push(
    "| `${env:NAME}` | environment | A process environment variable — the only channel for secrets. | `${env:SLACK_WEBHOOK_URL}` |"
  );

  return rows.join("\n");
}

/** The event catalog, with emitted/planned status and the groups each guarantees. */
export function renderEventsTable(): string {
  const rows: string[] = [
    "| Event | Role | Status | Guarantees |",
    "|---|---|---|---|",
  ];

  for (const e of EVENT_CATALOG) {
    const guarantees = e.provides.length > 0 ? e.provides.map((g) => `\`${g}\``).join(", ") : "—";
    rows.push(`| \`${e.name}\` | ${e.role} | ${e.status} | ${guarantees} |`);
  }

  return rows.join("\n");
}

/**
 * Replace the content between a start/end marker pair, preserving the markers.
 * Returns null when the markers are absent or out of order.
 */
export function replaceBetweenMarkers(
  content: string,
  start: string,
  end: string,
  replacement: string
): string | null {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;

  return (
    content.slice(0, startIndex + start.length) +
    "\n" +
    replacement +
    "\n" +
    content.slice(endIndex)
  );
}

/** Extract the content between a start/end marker pair, trimmed. */
export function extractBetweenMarkers(content: string, start: string, end: string): string | null {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;

  return content.slice(startIndex + start.length, endIndex).trim();
}

const isGitWorkflowHook = (name: string) => (GIT_WORKFLOW_HOOKS as readonly string[]).includes(name);
const registryJson = (hooks: unknown[]) => ["```json", JSON.stringify({ version: 1, hooks }, null, 2), "```"].join("\n");

/** The shipped definitions of the builtins that are on by default. */
export function renderBuiltinHooksJson(): string {
  return registryJson(BUILTIN_HOOKS.filter((hook) => !isGitWorkflowHook(hook.name)));
}

/** The Git workflow builtins enabled: exactly what `hook enable` writes for them. */
export function renderGitWorkflowHooksJson(): string {
  return registryJson(GIT_WORKFLOW_HOOKS.map((name) => ({ ...BUILTIN_HOOKS.find((hook) => hook.name === name)!, enabled: true })));
}
