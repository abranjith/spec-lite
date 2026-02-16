import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { updateCommand } from "./commands/update.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("spec-lite")
  .description(
    "Install structured AI agent prompts into your workspace for any AI coding assistant"
  )
  .version(pkg.version);

program
  .command("init")
  .description("Initialize spec-lite prompts in your workspace")
  .option(
    "--ai <provider>",
    "AI provider to configure for (copilot, claude-code, generic)"
  )
  .option(
    "--exclude <prompts>",
    "Comma-separated list of prompts to exclude (e.g., brainstorm,readme)"
  )
  .option("--force", "Overwrite existing files without prompting", false)
  .action(initCommand);

program
  .command("update")
  .description(
    "Update spec-lite prompts to the latest version, preserving your Project Context edits"
  )
  .option("--force", "Overwrite all files including user-modified ones", false)
  .action(updateCommand);

program.parse();
