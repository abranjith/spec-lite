import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { updateCommand } from "./commands/update.js";
import { listCommand } from "./commands/list.js";
import { installCommand } from "./commands/install.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

function collectOptionValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .name("spec-lite")
  .description(
    "Install structured AI sub-agent prompts into your workspace for any AI coding assistant"
  )
  .version(pkg.version);

program
  .command("init")
  .description("Initialize spec-lite sub-agent prompts in your workspace")
  .option(
    "--ai <provider>",
    "AI provider(s) to configure for; repeat flag or use comma-separated values (copilot, claude-code, pi, generic)",
    collectOptionValue,
    []
  )
  .option(
    "--exclude <prompts>",
    "Comma-separated list of prompts to exclude (e.g., brainstorm,readme)"
  )
  .option("--force", "Overwrite existing files without prompting", false)
  .option(
    "--skip-profile",
    "Skip the project profile questionnaire (for CI/scripting)"
  )
  .action(initCommand);

program
  .command("update")
  .description(
    "Update spec-lite prompts to the latest version, preserving your Project Context edits"
  )
  .option(
    "--ai <provider>",
    "Provider(s) to update; defaults to providers in .spec-lite.json. Repeat flag or use comma-separated values",
    collectOptionValue,
    []
  )
  .option("--force", "Overwrite all files including user-modified ones", false)
  .action(updateCommand);

program
  .command("install")
  .description("Install spec-lite prompts globally for use across all workspaces")
  .option(
    "--ai <provider>",
    "AI provider(s) to install for; repeat flag or use comma-separated values (copilot, claude-code, pi)",
    collectOptionValue,
    []
  )
  .option("--global", "Install prompts globally", false)
  .option(
    "--exclude <prompts>",
    "Comma-separated list of prompts to exclude"
  )
  .option("--force", "Overwrite existing global files without prompting", false)
  .action(installCommand);

program
  .command("list")
  .description("List all available spec-lite sub-agents and their purpose")
  .action(listCommand);

program.parse();
