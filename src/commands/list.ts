import chalk from "chalk";
import { getSourceCatalog } from "../utils/prompts.js";
import type { SourceItemKind } from "../providers/base.js";

export async function listCommand(): Promise<void> {
  const catalog = getSourceCatalog();

  console.log(chalk.bold("\n⚡ spec-lite — Available Agents & Skills\n"));

  console.log(
    chalk.dim(
      "  Agents are autonomous specialist workers. Skills are reusable task workflows.\n"
    )
  );

  // Group by kind
  const grouped: Record<SourceItemKind, [string, typeof catalog[string]][]> = {
    agent: [],
    skill: [],
    reference: [],
  };

  for (const [name, meta] of Object.entries(catalog)) {
    const kind = meta.kind ?? "agent";
    grouped[kind].push([name, meta]);
  }

  // Render each group
  const sections: { label: string; kind: SourceItemKind; color: typeof chalk.blue }[] = [
    { label: "Agents", kind: "agent", color: chalk.blue },
    { label: "Skills", kind: "skill", color: chalk.magenta },
    { label: "References", kind: "reference", color: chalk.yellow },
  ];

  let totalCount = 0;

  for (const { label, kind, color } of sections) {
    const entries = grouped[kind];
    if (entries.length === 0) continue;

    console.log(color.bold(`  ${label} (${entries.length}):\n`));

    const maxName = Math.max(...entries.map(([name]) => name.length), 4);

    for (const [name, meta] of entries) {
      const nameCol = chalk.green(name.padEnd(maxName + 2));
      const titleCol = chalk.white(meta.title.padEnd(20));
      const descCol = chalk.dim(meta.description);
      console.log(`    ${nameCol}${titleCol}${descCol}`);
      if (meta.output) {
        console.log(
          `    ${"".padEnd(maxName + 2)}${"".padEnd(20)}${chalk.dim(`→ ${meta.output}`)}`
        );
      }
    }

    console.log("");
    totalCount += entries.length;
  }

  console.log(
    chalk.dim(
      `  ${totalCount} items available. Run "spec-lite init" to install them.\n`
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
      "  Feature Planner → Implement  (shortcut for single-feature work)\n"
    )
  );
  console.log(
    chalk.dim(
      "  (Not every project needs every agent/skill. Start with Planner if you have clear requirements.)\n"
    )
  );
}
