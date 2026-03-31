import chalk from "chalk";
import { getPromptCatalog, isPromptOnly } from "../utils/prompts.js";

export async function listCommand(): Promise<void> {
  const catalog = getPromptCatalog();

  console.log(chalk.bold("\n⚡ spec-lite — Available Sub-Agents\n"));

  console.log(
    chalk.dim(
      "  Each sub-agent is a specialist prompt for one phase of the development lifecycle.\n"
    )
  );

  // Calculate column widths
  const entries = Object.entries(catalog);
  const maxName = Math.max(...entries.map(([name]) => name.length), 4);
  const maxTitle = Math.max(
    ...entries.map(([, v]) => v.title.length),
    5
  );
  const typeWidth = 12;

  // Header
  const header = `  ${"Name".padEnd(maxName + 2)}${"Type".padEnd(typeWidth + 2)}${"Title".padEnd(maxTitle + 2)}${"Description"}`;
  console.log(chalk.cyan(header));
  console.log(chalk.dim(`  ${"─".repeat(header.trim().length + 10)}`));

  // Rows
  for (const [name, meta] of entries) {
    const nameCol = chalk.green(name.padEnd(maxName + 2));
    const typeLabel = isPromptOnly(name) ? "prompt-only" : "agent+prompt";
    const typeCol = isPromptOnly(name)
      ? chalk.yellow(typeLabel.padEnd(typeWidth + 2))
      : chalk.blue(typeLabel.padEnd(typeWidth + 2));
    const titleCol = chalk.white(meta.title.padEnd(maxTitle + 2));
    const descCol = chalk.dim(meta.description);
    console.log(`  ${nameCol}${typeCol}${titleCol}${descCol}`);
    if (meta.output) {
      console.log(
        `  ${"".padEnd(maxName + 2)}${"".padEnd(typeWidth + 2)}${"".padEnd(maxTitle + 2)}${chalk.dim(`→ ${meta.output}`)}`
      );
    }
  }

  console.log(
    chalk.dim(
      `\n  ${entries.length} sub-agents available. Run "spec-lite init" to install them.\n`
    )
  );

  // Pipeline
  console.log(chalk.bold("  Recommended Pipeline:\n"));
  console.log(
    chalk.dim(
      "  Brainstorm → Planner → Feature (×N) → Implement → Reviews → Tests → DevOps → Docs"
    )
  );
  console.log(
    chalk.dim(
      "  Quick Spec → Implement  (shortcut for single-feature work)\n"
    )
  );
  console.log(
    chalk.dim(
      "  (Not every project needs every sub-agent. Start with Planner if you have clear requirements.)\n"
    )
  );
}
