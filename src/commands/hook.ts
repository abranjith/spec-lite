import path from "node:path";
import fs from "fs-extra";
import chalk from "chalk";
import { Command } from "commander";
import { runEvent } from "../hooks/runner.js";
import { loadRegistry, hooksForEvent } from "../hooks/registry.js";
import { EVENT_CATALOG, getEvent, resolvePattern } from "../hooks/events.js";
import { describeVars } from "../hooks/interpolation.js";

function parsePayloadFlags(values: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of values ?? []) {
    const i = kv.indexOf("=");
    if (i === -1) continue;
    out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function runAction(event: string, options: {
  feature?: string; task?: string; payload?: string[]; dryRun?: boolean; json?: boolean; runId?: string; only?: string;
}): Promise<void> {
  const root = process.cwd();
  const report = await runEvent({
    root,
    event,
    featureId: options.feature,
    taskId: options.task,
    runId: options.runId,
    extra: parsePayloadFlags(options.payload),
    dryRun: options.dryRun,
    only: options.only,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.disabled) {
      console.log(chalk.dim("  hooks disabled via .spec-lite.json (hooks.enabled: false) — nothing dispatched"));
    }
    for (const issue of report.registryIssues) {
      console.log(issue.startsWith("[error]") ? chalk.red(issue) : chalk.yellow(issue));
    }
    for (const r of report.results) {
      const icon = r.status === "ok" || r.status === "emitted" ? chalk.green("✓")
        : r.status === "skipped" ? chalk.dim("−")
        : chalk.red("✗");
      console.log(`  ${icon} ${r.name} (${r.kind}) ${chalk.dim(`[${r.status}]`)}${r.message ? ` — ${r.message}` : ""}`);
      if (r.directive) console.log(`    ${r.directive}`);
      if (r.preview) console.log(chalk.dim(`    ${r.preview.split("\n").join("\n    ")}`));
    }
  }

  process.exitCode = report.exitCode;
}

async function listAction(options: { event?: string }): Promise<void> {
  const root = process.cwd();
  const { hooks, issues } = await loadRegistry(root);
  const filtered = options.event ? hooksForEvent(hooks, options.event) : hooks;

  for (const issue of issues) {
    console.log(issue.level === "error" ? chalk.red(`[error] ${issue.message}`) : chalk.yellow(`[warning] ${issue.message}`));
  }
  for (const hook of filtered) {
    const status = hook.enabled === false ? chalk.dim("disabled") : chalk.green("enabled");
    console.log(`${chalk.bold(hook.name)} ${chalk.dim(`(${hook.source})`)} — ${hook.type} — ${status}`);
    console.log(`  events: ${hook.events.join(", ")}`);
    if (hook.description) console.log(`  ${chalk.dim(hook.description)}`);
  }
}

function eventsAction(): void {
  for (const e of EVENT_CATALOG) {
    const tag = e.status === "emitted" ? chalk.green("emitted") : chalk.yellow("planned");
    console.log(`${chalk.bold(e.name)} ${chalk.dim(`(${e.role}, ${e.phase})`)} — ${tag}`);
    console.log(`  ${chalk.dim(e.description)}`);
  }
}

async function validateAction(): Promise<void> {
  const root = process.cwd();
  const { issues } = await loadRegistry(root);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  for (const w of warnings) console.log(chalk.yellow(`[warning] ${w.hook ? `${w.hook}: ` : ""}${w.message}`));
  for (const e of errors) console.log(chalk.red(`[error] ${e.hook ? `${e.hook}: ` : ""}${e.message}`));

  if (errors.length > 0) {
    console.log(chalk.red(`\n${errors.length} error(s), ${warnings.length} warning(s).`));
    process.exitCode = 2;
  } else {
    console.log(chalk.green(`Registry valid. ${warnings.length} warning(s).`));
  }
}

/**
 * Exercise one hook in isolation against a synthetic (or supplied) payload,
 * without needing the emitting role to reach its lifecycle point. Runs the
 * real executor, so a `command` hook really executes — this is a test harness
 * for the hook author, not a dry run.
 */
async function testAction(name: string, options: { event?: string; payload?: string; feature?: string; task?: string }): Promise<void> {
  const root = process.cwd();
  const { hooks } = await loadRegistry(root);
  const hook = hooks.find((h) => h.name === name);

  if (!hook) {
    console.log(chalk.red(`No enabled hook named "${name}". Run \`spec-lite hook list\` to see resolved hooks.`));
    process.exitCode = 2;
    return;
  }

  // Default to the first concrete event the hook subscribes to, so the common
  // case needs no --event flag.
  let event = options.event;
  if (!event) {
    const firstPattern = hook.events[0];
    event = resolvePattern(firstPattern).matched[0]?.name;
  }
  if (!event || !getEvent(event)) {
    console.log(chalk.red(`Could not resolve an event for "${name}". Pass --event explicitly.`));
    process.exitCode = 2;
    return;
  }

  let extra: Record<string, string> = {};
  if (options.payload) {
    try {
      const fileContents = await fs.readJson(path.resolve(root, options.payload));
      extra = Object.fromEntries(
        Object.entries(fileContents as Record<string, unknown>).map(([k, v]) => [
          k,
          typeof v === "string" ? v : JSON.stringify(v),
        ])
      );
    } catch (err) {
      console.log(chalk.red(`Could not read payload file: ${(err as Error).message}`));
      process.exitCode = 2;
      return;
    }
  }

  console.log(chalk.dim(`Testing "${name}" against event ${event}\n`));
  await runAction(event, {
    feature: options.feature,
    task: options.task,
    payload: Object.entries(extra).map(([k, v]) => `${k}=${v}`),
    only: name,
  });
}

function varsAction(): void {
  const groups = new Map<string, string[]>();
  for (const v of describeVars()) {
    const lines = groups.get(v.group) ?? [];
    lines.push(`  \${${v.name}}  ${chalk.dim(v.description)}  ${chalk.dim(`e.g. ${v.example}`)}`);
    groups.set(v.group, lines);
  }
  for (const [group, lines] of groups) {
    console.log(chalk.bold(group === "base" ? "base (every event)" : group));
    for (const line of lines) console.log(line);
  }
  console.log(chalk.dim("\n${name:-default} supplies a fallback. ${env:NAME} reads the environment."));
}

export function registerHookCommand(program: Command): void {
  const hook = program.command("hook").description("Run and inspect spec-lite lifecycle hooks");

  hook
    .command("run <event>")
    .description("Fire one event, dispatching every subscribed hook in order")
    .option("--feature <id>", "Feature ID, e.g. FEAT-012")
    .option("--task <id>", "Task ID, e.g. TASK-003")
    .option("--payload <kv>", "Additional payload key=value (repeatable)", collect, [])
    .option("--run-id <id>", "Reuse a runId across multiple hook run calls")
    .option("--dry-run", "Resolve and print without executing", false)
    .option("--json", "Machine-readable output", false)
    .action(runAction);

  hook
    .command("list")
    .description("List resolved hooks, builtins -> global -> project merged")
    .option("--event <name>", "Only hooks subscribed to this concrete event")
    .action(listAction);

  hook
    .command("events")
    .description("Print the full event catalog with emitted/planned status")
    .action(eventsAction);

  hook
    .command("validate")
    .description("Validate the merged registry — schema, event names, and interpolation templates")
    .action(validateAction);

  hook
    .command("test <name>")
    .description("Run one hook in isolation against a synthetic or supplied payload")
    .option("--event <name>", "Event to simulate (defaults to the hook's first subscribed event)")
    .option("--payload <file>", "JSON file whose top-level keys become payload values")
    .option("--feature <id>", "Feature ID, e.g. FEAT-012")
    .option("--task <id>", "Task ID, e.g. TASK-003")
    .action(testAction);

  hook
    .command("vars")
    .description("Print the ${...} interpolation variable table")
    .action(varsAction);
}
