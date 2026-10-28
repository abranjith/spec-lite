/**
 * Renders the generated documentation blocks for the hook system.
 *
 * These are the single source of truth for what ends up between the marker
 * comments in the hook pages under docs/features/ (GENERATED_BLOCKS says
 * which block lives on which page). A test asserts the docs match what this
 * produces, so they cannot drift from the resolver, the event catalog, or the
 * builtins.
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
export const GIT_WORKFLOW_HOOKS_START =
  "<!-- git-workflow-hooks-json:start -->";
export const GIT_WORKFLOW_HOOKS_END = "<!-- git-workflow-hooks-json:end -->";
export const optionsTableStart = (group: string) =>
  `<!-- builtin-options-table:${group}:start -->`;
export const optionsTableEnd = (group: string) =>
  `<!-- builtin-options-table:${group}:end -->`;

/** The hook documentation pages, relative to the repository root. */
export const HOOK_DOCS = {
  main: "docs/features/hooks.md",
  gitWorkflow: "docs/features/hooks-git-workflow.md",
  control: "docs/features/hooks-gates-checkpoints.md",
} as const;

/** Builtins whose options are documented together, on the page that explains them. */
export const OPTIONS_TABLES: Record<
  string,
  { file: string; hooks: readonly string[] }
> = {
  "git-workflow": { file: HOOK_DOCS.gitWorkflow, hooks: GIT_WORKFLOW_HOOKS },
  checkpoint: { file: HOOK_DOCS.control, hooks: ["checkpoint"] },
};

const GROUP_LABELS: Record<string, string> = {
  base: "base — every event",
  workflow: "workflow — tracked runs",
  execution: "execution — tracked runs",
  action: "action — optional",
  decision: "decision — checkpoint events",
  "decision-resolved": "decision-resolved — after an answer",
};

/** The `${...}` variable reference table, grouped, in catalog order. */
export function renderVarsTable(): string {
  const rows: string[] = [
    "| Variable | Group | Meaning | Example |",
    "|---|---|---|---|",
  ];

  for (const v of describeVars()) {
    const label = GROUP_LABELS[v.group] ?? v.group;
    rows.push(
      `| \`\${${v.name}}\` | ${label} | ${v.description} | \`${v.example}\` |`
    );
  }

  rows.push(
    "| `${env:NAME}` | environment | A process environment variable — the only channel for secrets. Allowed only in `run`, `cwd`, `env`, `url`, `headers`, and `bodyTemplate`. | `${env:SLACK_WEBHOOK_URL}` |"
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
    const guarantees =
      e.provides.length > 0
        ? e.provides.map((g) => `\`${g}\``).join(", ")
        : "—";
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
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex)
    return null;

  return (
    content.slice(0, startIndex + start.length) +
    "\n" +
    replacement +
    "\n" +
    content.slice(endIndex)
  );
}

/** Extract a trimmed block, normalizing CRLF to LF for generated-content comparisons. */
export function extractBetweenMarkers(
  content: string,
  start: string,
  end: string
): string | null {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex)
    return null;

  return content
    .slice(startIndex + start.length, endIndex)
    .replace(/\r\n/g, "\n")
    .trim();
}

const registryJson = (hooks: unknown[]) =>
  ["```json", JSON.stringify({ version: 1, hooks }, null, 2), "```"].join("\n");

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
  return registryJson(
    GIT_WORKFLOW_HOOKS.map((name) => {
      const options = EXAMPLE_OPTIONS[name];
      return { name, enabled: true, ...(options ? { options } : {}) };
    })
  );
}

function optionType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => `\`"${value}"\``).join(", ");
  if (schema.type === "array")
    return `${(schema.items as Record<string, unknown> | undefined)?.type ?? "value"} array`;
  return String(schema.type);
}

/**
 * Options of the given builtins, from their declarations in
 * builtins/options.ts. A table for one builtin leaves out the Hook column.
 */
export function renderBuiltinOptionsTable(hooks: readonly string[]): string {
  const single = hooks.length === 1;
  const rows = single
    ? ["| Option | Type | Meaning |", "|---|---|---|"]
    : ["| Hook | Option | Type | Meaning |", "|---|---|---|---|"];
  for (const hook of hooks) {
    for (const [name, option] of Object.entries(
      BUILTIN_OPTIONS[hook]?.options ?? {}
    )) {
      const cells = [
        `\`${name}\``,
        optionType(option.schema),
        `${option.required ? "**Required.** " : ""}${option.description}`,
      ];
      if (!single) cells.unshift(`\`${hook}\``);
      rows.push(`| ${cells.join(" | ")} |`);
    }
  }
  return rows.join("\n");
}

export interface GeneratedBlock {
  label: string;
  file: string;
  start: string;
  end: string;
  render: () => string;
}

/** Every generated block in the hook docs, and the page it lives on. */
export const GENERATED_BLOCKS: GeneratedBlock[] = [
  {
    label: "interpolation variable table",
    file: HOOK_DOCS.main,
    start: VARS_TABLE_START,
    end: VARS_TABLE_END,
    render: renderVarsTable,
  },
  {
    label: "event catalog table",
    file: HOOK_DOCS.main,
    start: EVENTS_TABLE_START,
    end: EVENTS_TABLE_END,
    render: renderEventsTable,
  },
  {
    label: "shipped builtin definitions",
    file: HOOK_DOCS.main,
    start: BUILTIN_HOOKS_START,
    end: BUILTIN_HOOKS_END,
    render: renderBuiltinHooksJson,
  },
  {
    label: "Git workflow hook entries",
    file: HOOK_DOCS.gitWorkflow,
    start: GIT_WORKFLOW_HOOKS_START,
    end: GIT_WORKFLOW_HOOKS_END,
    render: renderGitWorkflowHooksJson,
  },
  ...Object.entries(OPTIONS_TABLES).map(([group, table]) => ({
    label: `${group} options table`,
    file: table.file,
    start: optionsTableStart(group),
    end: optionsTableEnd(group),
    render: () => renderBuiltinOptionsTable(table.hooks),
  })),
];
