import chalk from "chalk";
import { Command } from "commander";
import { cleanupMerged, cleanupWorkflow, listWorkflows } from "../hooks/builtins/worktree-lifecycle.js";

async function listAction(options: { json?: boolean }): Promise<void> {
  try {
    const workflows = await listWorkflows(process.cwd());
    if (options.json) {
      console.log(JSON.stringify(workflows, null, 2));
      return;
    }
    if (!workflows.length) console.log(chalk.dim("No Git workflows. prepare-worktree creates one when Implement or Fix starts."));
    for (const workflow of workflows) {
      const status = workflow.status === "active" ? chalk.green(workflow.status) : chalk.yellow(workflow.status);
      console.log(`${chalk.bold(workflow.name)} — ${workflow.identity} — ${status}`);
      console.log(chalk.dim(`  ${workflow.branch}  ${workflow.path}`));
    }
  } catch (err) {
    console.log(chalk.red((err as Error).message));
    process.exitCode = 1;
  }
}

async function cleanupAction(name: string | undefined, options: { merged?: boolean }): Promise<void> {
  if (!name === !options.merged) {
    console.log(chalk.red("Name one workflow, or pass --merged to clean up every merged workflow."));
    process.exitCode = 2;
    return;
  }
  try {
    const done = name ? await cleanupWorkflow(process.cwd(), name) : await cleanupMerged(process.cwd());
    for (const line of done) console.log(line.startsWith("Skipped") || line.startsWith("Kept") ? chalk.yellow(line) : chalk.green(line));
    if (!done.length) console.log(chalk.dim("Nothing to clean up."));
  } catch (err) {
    console.log(chalk.red((err as Error).message));
    process.exitCode = 1;
  }
}

export function registerWorktreeCommand(program: Command): void {
  const worktree = program.command("worktree").description("List and clean up worktrees made by the Git workflow hooks");

  worktree
    .command("list")
    .description("List Git workflows: name, scope, branch, and whether the worktree still exists")
    .option("--json", "Machine-readable output", false)
    .action(listAction);

  worktree
    .command("cleanup [name]")
    .description("After merging: remove a workflow's worktree, branch, and state, and reset copied specs in the main checkout")
    .option("--merged", "Clean up every workflow whose branch is merged; skip the rest", false)
    .action(cleanupAction);
}
