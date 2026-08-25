import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { updateCommand } from "./commands/update.js";
import { listCommand } from "./commands/list.js";
import { installCommand } from "./commands/install.js";
import { exportCommand } from "./commands/export.js";
import { registerHookCommand } from "./commands/hook.js";
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
    "AI provider(s) to configure for; repeat flag or use comma-separated values (copilot, claude-code, codex, pi, generic)",
    collectOptionValue,
    []
  )
  .option(
    "--exclude <prompts>",
    "Comma-separated list of prompts to exclude (e.g., brainstorm,document-readme)"
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
    "Provider(s) to update; defaults to providers in .spec-lite.json (copilot, claude-code, codex, pi, generic). Repeat flag or use comma-separated values",
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
    "AI provider(s) to install for; repeat flag or use comma-separated values (copilot, claude-code, codex, pi)",
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

program
  .command("export [names...]")
  .description("Bundle selected agents, skills, and references into one self-contained Markdown file")
  .option("--all", "Export every available item", false)
  .option("-o, --output <file>", 'Output file (default: "spec-lite-prompts.md"; use "-" for stdout)')
  .option("--no-references", "Omit references when used with --all")
  .action(exportCommand);

registerHookCommand(program);

program.parse();
