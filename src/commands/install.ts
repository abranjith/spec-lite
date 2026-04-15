import path from "path";
import os from "os";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteGlobalConfig } from "../providers/base.js";
import { loadAllSources } from "../utils/prompts.js";

interface InstallOptions {
  ai?: string;
  global?: boolean;
  exclude?: string;
  force?: boolean;
}

export async function installCommand(options: InstallOptions): Promise<void> {
  if (!options.global) {
    console.error(
      chalk.red(
        '  The install command currently requires --global. Use "spec-lite init" for project-level setup.'
      )
    );
    process.exit(1);
  }

  console.log(chalk.bold("\n⚡ spec-lite install --global\n"));

  // 1. Resolve provider
  let providerAlias = options.ai;

  if (!providerAlias) {
    const providers = getAllProviders().filter((p) => p.supportsGlobal);
    if (providers.length === 0) {
      console.error(chalk.red("  No providers support global installation."));
      process.exit(1);
    }

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Which AI coding assistant are you installing for?",
        choices: providers.map((p) => ({
          name: `${p.name} — ${p.description}`,
          value: p.alias,
        })),
      },
    ]);
    providerAlias = answer.provider as string;
  }

  const provider = getProvider(providerAlias!);
  if (!provider) {
    console.error(
      chalk.red(
        `Unknown provider: "${providerAlias}". Available: ${getAllProviders()
          .map((p) => p.alias)
          .join(", ")}`
      )
    );
    process.exit(1);
  }

  if (!provider.supportsGlobal || !provider.getGlobalOutputPaths) {
    console.error(
      chalk.red(`  Provider "${provider.name}" does not support global installation.`)
    );
    process.exit(1);
  }

  console.log(chalk.cyan(`  Provider: ${provider.name}`));

  // 2. Parse exclusions
  const exclude = options.exclude
    ? options.exclude.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  if (exclude.length > 0) {
    console.log(chalk.dim(`  Excluding: ${exclude.join(", ")}`));
  }

  // 3. Check for existing global config
  const homeDir = os.homedir();
  const globalConfigDir = path.join(homeDir, ".spec-lite");
  const globalConfigPath = path.join(globalConfigDir, "global-config.json");

  if (!options.force && (await fs.pathExists(globalConfigPath))) {
    const existingConfig: SpecLiteGlobalConfig = await fs.readJson(globalConfigPath);
    if (existingConfig.provider === provider.alias) {
      const answer = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: `Global prompts for ${provider.name} are already installed. Overwrite?`,
          default: false,
        },
      ]);
      if (!answer.overwrite) {
        console.log(chalk.dim("  Aborted."));
        return;
      }
    }
  }

  // 4. Load and write prompts (new agents/skills structure with legacy fallback)
  const sources = await loadAllSources(exclude);
  let written = 0;
  const installedPrompts: string[] = [];

  for (const source of sources) {
    const meta = {
      name: source.promptName,
      title: source.title,
      description: source.description,
    };
    const paths = provider.getGlobalOutputPaths(source.name);

    // --- Agent file (global) ---
    if (paths.agent && provider.supportsAgents && provider.transformAgent) {
      const transformed = provider.transformAgent(source.content, meta);
      await fs.ensureDir(path.dirname(paths.agent));
      await fs.writeFile(paths.agent, transformed, "utf-8");
      written++;
      console.log(chalk.green(`  ✓ ${paths.agent}`));
    }

    // --- Prompt file (global) ---
    if (paths.prompt) {
      const transformed = provider.transformPrompt(source.content, meta);
      await fs.ensureDir(path.dirname(paths.prompt));
      await fs.writeFile(paths.prompt, transformed, "utf-8");
      written++;
      console.log(chalk.green(`  ✓ ${paths.prompt}`));
    }

    installedPrompts.push(source.name);
  }

  // 5. Write global config
  const pkg = await loadPackageVersion();
  const globalConfig: SpecLiteGlobalConfig = {
    version: pkg,
    provider: provider.alias,
    installedPrompts,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.ensureDir(globalConfigDir);
  await fs.writeJson(globalConfigPath, globalConfig, { spaces: 2 });
  console.log(chalk.green(`  ✓ ~/.spec-lite/global-config.json`));

  // 6. Summary
  console.log(chalk.bold(`\n  Done! ${written} files written globally.`));

  if (provider.getGlobalPostInstallMessage) {
    console.log(provider.getGlobalPostInstallMessage());
  }

  if (installedPrompts.includes("plan_critic")) {
    let planCriticNote: string | undefined;

    switch (provider.alias) {
      case "copilot":
        planCriticNote =
          "  💡 Optional checkpoint after planning: /spec.plan_critic .spec-lite/plan.md";
        break;
      case "claude-code":
        planCriticNote =
          "  💡 Optional checkpoint after planning: use spec.plan_critic against .spec-lite/plan.md in Claude Code.";
        break;
      case "pi":
        planCriticNote =
          "  💡 Optional checkpoint after planning: /spec.plan_critic .spec-lite/plan.md";
        break;
    }

    if (planCriticNote) {
      console.log(`\n${planCriticNote}`);
    }
  }
}

async function loadPackageVersion(): Promise<string> {
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    return pkg.version;
  } catch {
    return "unknown";
  }
}
