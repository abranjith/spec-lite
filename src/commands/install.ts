import path from "path";
import os from "os";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteGlobalConfig } from "../providers/base.js";
import { loadAllSources, copyNativeSkillDir } from "../utils/prompts.js";

interface InstallOptions {
  ai?: string | string[];
  global?: boolean;
  exclude?: string;
  force?: boolean;
}

function dedupeValues(values: string[]): string[] {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueValues.push(value);
  }

  return uniqueValues;
}

function parseProviderAliases(input?: string | string[]): string[] {
  const rawValues = Array.isArray(input) ? input : input ? [input] : [];
  return dedupeValues(
    rawValues
      .flatMap((value) => value.split(/[\s,]+/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getPlanCriticNote(providerAlias: string): string | undefined {
  switch (providerAlias) {
    case "copilot":
      return "  💡 Optional checkpoint after planning: /spec.plan_critic .spec-lite/plan.md";
    case "claude-code":
      return "  💡 Optional checkpoint after planning: use spec.plan_critic against .spec-lite/plan.md in Claude Code.";
    case "pi":
      return "  💡 Optional checkpoint after planning: /spec.plan_critic .spec-lite/plan.md";
    default:
      return undefined;
  }
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

  // 1. Resolve provider(s)
  let providerAliases = parseProviderAliases(options.ai);

  const globalProviders = getAllProviders().filter((p) => p.supportsGlobal);
  if (globalProviders.length === 0) {
    console.error(chalk.red("  No providers support global installation."));
    process.exit(1);
  }

  if (providerAliases.length === 0) {
    const providers = globalProviders;
    const answer = await inquirer.prompt([
      {
        type: "checkbox",
        name: "providers",
        message: "Which AI coding assistant(s) are you installing for?",
        choices: providers.map((p) => ({
          name: `${p.name} — ${p.description}`,
          value: p.alias,
        })),
        validate: (input: string[]) =>
          input.length > 0 ? true : "Select at least one provider.",
      },
    ]);
    providerAliases = dedupeValues((answer.providers as string[]) ?? []);
  }

  const providers = providerAliases.map((providerAlias) => {
    const provider = getProvider(providerAlias);
    if (!provider) {
      console.error(
        chalk.red(
          `Unknown provider: "${providerAlias}". Available: ${globalProviders
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

    return provider;
  });

  console.log(chalk.cyan(`  Providers: ${providers.map((provider) => provider.name).join(", ")}`));

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
    const existingProviders = new Set(
      (Array.isArray(existingConfig.providers)
        ? existingConfig.providers
        : [existingConfig.provider]
      )
        .map((providerAlias) => providerAlias?.trim().toLowerCase())
        .filter((providerAlias): providerAlias is string => !!providerAlias)
    );

    const overlappingProviders = providers.filter((provider) =>
      existingProviders.has(provider.alias)
    );

    if (overlappingProviders.length > 0) {
      const answer = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: `Global prompts for ${overlappingProviders.map((provider) => provider.name).join(", ")} are already installed. Overwrite?`,
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
  const installedPrompts = sources.map((source) => source.name);

  for (const provider of providers) {
    console.log(chalk.cyan(`\n  Installing global prompts for ${provider.name}...`));

    for (const source of sources) {
      const meta = {
        name: source.promptName,
        title: source.title,
        description: source.description,
      };
      const paths = provider.getGlobalOutputPaths!(source.name);
      const isNativeSkill =
        source.kind === "skill" &&
        !!source.frontmatter &&
        provider.supportsNativeSkills &&
        !!provider.getGlobalSkillOutputDir;

      // --- Native skill directory (global, if provider supports Agent Skills format) ---
      if (isNativeSkill) {
        const skillOutDir = provider.getGlobalSkillOutputDir!(source.name);
        const filesCopied = await copyNativeSkillDir(
          source.rootPath,
          skillOutDir,
          { contextBlock: null }
        );
        written += filesCopied;
      }

      // --- Agent file (global) ---
      if (paths.agent && provider.supportsAgents && provider.transformAgent) {
        const transformed = provider.transformAgent(source.content, meta);
        await fs.ensureDir(path.dirname(paths.agent));
        await fs.writeFile(paths.agent, transformed, "utf-8");
        written++;
        console.log(chalk.green(`  ✓ ${paths.agent}`));
      }

      // --- Prompt file (global, skip for native skills) ---
      if (!isNativeSkill && paths.prompt) {
        const transformed = provider.transformPrompt(source.content, meta);
        await fs.ensureDir(path.dirname(paths.prompt));
        await fs.writeFile(paths.prompt, transformed, "utf-8");
        written++;
        console.log(chalk.green(`  ✓ ${paths.prompt}`));
      }
    }
  }

  // 5. Write global config
  const pkg = await loadPackageVersion();
  const globalConfig: SpecLiteGlobalConfig = {
    version: pkg,
    provider: providers[0].alias,
    providers: providers.map((provider) => provider.alias),
    installedPrompts,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.ensureDir(globalConfigDir);
  await fs.writeJson(globalConfigPath, globalConfig, { spaces: 2 });
  console.log(chalk.green(`  ✓ ~/.spec-lite/global-config.json`));

  // 6. Summary
  console.log(chalk.bold(`\n  Done! ${written} files written globally across ${providers.length} provider(s).`));

  for (const provider of providers) {
    if (provider.getGlobalPostInstallMessage) {
      console.log(provider.getGlobalPostInstallMessage());
    }
  }

  if (installedPrompts.includes("plan_critic")) {
    const planCriticNotes = dedupeValues(
      providers
        .map((provider) => getPlanCriticNote(provider.alias))
        .filter((note): note is string => !!note)
    );

    for (const planCriticNote of planCriticNotes) {
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
