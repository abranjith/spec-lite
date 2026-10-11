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
import { BUILTIN_OPTIONS } from "./builtins/options.js";

export const VARS_TABLE_START = "<!-- hook-vars-table:start -->";
export const VARS_TABLE_END = "<!-- hook-vars-table:end -->";
export const EVENTS_TABLE_START = "<!-- hook-events-table:start -->";
export const EVENTS_TABLE_END = "<!-- hook-events-table:end -->";
export const BUILTIN_HOOKS_START = "<!-- builtin-hooks-json:start -->";
export const BUILTIN_HOOKS_END = "<!-- builtin-hooks-json:end -->";
export const GIT_WORKFLOW_HOOKS_START = "<!-- git-workflow-hooks-json:start -->";
export const GIT_WORKFLOW_HOOKS_END = "<!-- git-workflow-hooks-json:end -->";
export const BUILTIN_OPTIONS_START = "<!-- builtin-options-table:start -->";
export const BUILTIN_OPTIONS_END = "<!-- builtin-options-table:end -->";

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

/** Extract a trimmed block, normalizing CRLF to LF for generated-content comparisons. */
export function extractBetweenMarkers(content: string, start: string, end: string): string | null {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;

  return content.slice(startIndex + start.length, endIndex).replace(/\r\n/g, "\n").trim();
}

const registryJson = (hooks: unknown[]) => ["```json", JSON.stringify({ version: 1, hooks }, null, 2), "```"].join("\n");

/** Every builtin as it ships: a reference, never something to copy. */
export function renderBuiltinHooksJson(): string {
  return registryJson(BUILTIN_HOOKS);
}

/** Options the docs' Git workflow example sets; everything else keeps its default. */
const EXAMPLE_OPTIONS: Record<string, Record<string, unknown>> = {
  "prepare-worktree": { fromBranch: "develop" },
  "create-pull-request": { provider: "github", targetBranch: "develop" },
};

/** The Git workflow builtins enabled with example options, as settings-only entries. */
export function renderGitWorkflowHooksJson(): string {
  return registryJson(GIT_WORKFLOW_HOOKS.map((name) => {
    const options = EXAMPLE_OPTIONS[name];
    return { name, enabled: true, ...(options ? { options } : {}) };
  }));
}

function optionType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => `\`"${value}"\``).join(", ");
  if (schema.type === "array") return "string array";
  return String(schema.type);
}

/** Every builtin's options, from their declarations in builtins/options.ts. */
export function renderBuiltinOptionsTable(): string {
  const rows = ["| Hook | Option | Type | Meaning |", "|---|---|---|---|"];
  for (const [hook, spec] of Object.entries(BUILTIN_OPTIONS)) {
    for (const [name, option] of Object.entries(spec.options)) {
      rows.push(`| \`${hook}\` | \`${name}\` | ${optionType(option.schema)} | ${option.required ? "**Required.** " : ""}${option.description} |`);
    }
  }
  return rows.join("\n");
}
