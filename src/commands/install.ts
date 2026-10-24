import path from "path";
import os from "os";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteGlobalConfig } from "../providers/base.js";
import {
  copyNativeSkillDir,
  hasPromptName,
  loadAllSources,
  replaceProjectContext,
} from "../utils/prompts.js";
import { mergeCodexAgentsMd } from "../providers/codex.js";
import { getPackageVersion } from "../utils/package-version.js";
import { resolveLegacyRenames } from "../utils/stale-sources.js";
import {
  OutputPreservation,
  backupAndRemoveLegacy,
} from "../utils/output-preservation.js";
import type { LegacyRename } from "../utils/stale-sources.js";
import { InstalledLinks } from "../utils/installed-links.js";
import { migrateHookRequires } from "../hooks/migration.js";
import { globalHooksJsonPath } from "../hooks/workspace.js";

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
      return "  💡 Optional checkpoint after planning: /spec-plan-critic .spec-lite/plan.md";
    case "claude-code":
      return "  💡 Optional checkpoint after planning: /spec-plan-critic .spec-lite/plan.md in Claude Code.";
    case "codex":
      return "  💡 Optional checkpoint after planning: ask Codex to use the spec-plan-critic skill against .spec-lite/plan.md.";
    case "pi":
      return "  💡 Optional checkpoint after planning: /skill:spec-plan-critic .spec-lite/plan.md";
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
        chalk.red(
          `  Provider "${provider.name}" does not support global installation.`
        )
      );
      process.exit(1);
    }

    return provider;
  });

  console.log(
    chalk.cyan(
      `  Providers: ${providers.map((provider) => provider.name).join(", ")}`
    )
  );

  // 2. Parse exclusions
  const exclude = options.exclude
    ? options.exclude
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (exclude.length > 0) {
    console.log(chalk.dim(`  Excluding: ${exclude.join(", ")}`));
  }

  // 3. Check for existing global config
  const homeDir = os.homedir();
  const globalConfigDir = path.join(homeDir, ".spec-lite");
  const globalConfigPath = path.join(globalConfigDir, "global-config.json");

  if (!options.force && (await fs.pathExists(globalConfigPath))) {
    const existingConfig: SpecLiteGlobalConfig =
      await fs.readJson(globalConfigPath);
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
  const linkSources = await loadAllSources();
  let written = 0;
  const installedPrompts = sources.map((source) => source.name);
  // Snapshot originals before any writes, including outputs whose names did not change.
  const legacyRenames = new Map<string, LegacyRename[]>();
  for (const provider of providers) {
    legacyRenames.set(
      provider.alias,
      await resolveLegacyRenames(homeDir, provider, sources, "global")
    );
  }
  const renamedOutputs: Array<LegacyRename & { provider: string }> = [];

  for (const provider of providers) {
    console.log(
      chalk.cyan(`\n  Installing global prompts for ${provider.name}...`)
    );
    const nativeSkillNames = new Set<string>();
    const links = new InstalledLinks(
      provider,
      homeDir,
      linkSources,
      sources,
      "global"
    );
    const preservation = new OutputPreservation(
      provider,
      homeDir,
      legacyRenames.get(provider.alias) ?? [],
      !!options.force
    );

    for (const source of sources) {
      // Codex has no native primitive for prompt-only reference docs.
      if (provider.alias === "codex" && source.kind === "reference") {
        continue;
      }

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
        // Claude's old global skills were agent files; seed newly native skills
        // from that role's original context as well as preserving the new agent.
        const legacyAgentContext =
          provider.alias === "claude-code"
            ? (legacyRenames
                .get(provider.alias)
                ?.find((rename) => rename.newPath === paths.agent)
                ?.contextBlock ?? null)
            : null;
        const contextBlock = await preservation.contextFor(
          path.join(skillOutDir, "SKILL.md"),
          source.content,
          legacyAgentContext
        );
        const filesCopied = await copyNativeSkillDir(
          source.rootPath,
          skillOutDir,
          { contextBlock, rewriteFile: links.rewriteFile.bind(links) }
        );
        written += filesCopied;
        nativeSkillNames.add(source.name);
      }

      // --- Agent file (global) ---
      if (
        paths.agent &&
        provider.supportsAgents &&
        provider.transformAgent &&
        (!source.promptOnly || provider.alias === "copilot")
      ) {
        const context = await preservation.contextFor(
          paths.agent,
          source.content
        );
        const content = links.rewrite(source, source.content, paths.agent);
        const transformed = provider.transformAgent(
          context !== null ? replaceProjectContext(content, context) : content,
          meta
        );
        await fs.ensureDir(path.dirname(paths.agent));
        await fs.writeFile(paths.agent, transformed, "utf-8");
        written++;
        console.log(chalk.green(`  ✓ ${paths.agent}`));
      }

      // --- Prompt file (global, skip for native skills) ---
      if (!isNativeSkill && paths.prompt) {
        const context = await preservation.contextFor(
          paths.prompt,
          source.content
        );
        const content = links.rewrite(source, source.content, paths.prompt);
        const transformed = provider.transformPrompt(
          context !== null ? replaceProjectContext(content, context) : content,
          meta
        );
        await fs.ensureDir(path.dirname(paths.prompt));
        await fs.writeFile(paths.prompt, transformed, "utf-8");
        written++;
        console.log(chalk.green(`  ✓ ${paths.prompt}`));
      }
    }

    await links.writeSupportingFiles();
    renamedOutputs.push(
      ...(await preservation.removableRenames()).map((rename) => ({
        ...rename,
        provider: provider.name,
      }))
    );

    if (provider.alias === "codex") {
      const codexInstalledPrompts = sources
        .filter((source) => source.kind !== "reference")
        .map((source) => source.name);
      const agentsMdPath = path.join(os.homedir(), ".codex", "AGENTS.md");
      const existingContent = (await fs.pathExists(agentsMdPath))
        ? await fs.readFile(agentsMdPath, "utf-8")
        : null;
      const merged = mergeCodexAgentsMd(
        existingContent,
        codexInstalledPrompts,
        nativeSkillNames,
        { scope: "global" }
      );
      await fs.ensureDir(path.dirname(agentsMdPath));
      await fs.writeFile(agentsMdPath, merged, "utf-8");
      written++;
      console.log(chalk.green(`  ✓ ${agentsMdPath}`));
    }
  }

  // 4b. Pre-0.5.0 installs used dotted `spec.<name>` files; their renamed
  // replacements are now written, so offer to remove the originals.
  if (renamedOutputs.length > 0) {
    console.log(
      chalk.yellow(
        "\n  Global outputs renamed to Agent Skills names (https://agentskills.io/specification):"
      )
    );
    for (const rename of renamedOutputs) {
      console.log(
        chalk.yellow(
          `    - [${rename.provider}] ${rename.legacyPath}  →  ${rename.newPath}`
        )
      );
    }

    let removeLegacy = !!options.force;
    if (!options.force) {
      const answer = await inquirer.prompt<{ removeLegacy: boolean }>([
        {
          type: "confirm",
          name: "removeLegacy",
          message: "Remove the old global files?",
          default: true,
        },
      ]);
      removeLegacy = answer.removeLegacy;
    }

    if (removeLegacy) {
      for (const rename of renamedOutputs) {
        await backupAndRemoveLegacy(homeDir, rename);
        console.log(chalk.green(`  ✓ ${rename.legacyPath} (removed old name)`));
      }
    }
  }

  // 4c. Global hooks relying on a variable the corrected event catalog no
  // longer promises would stop every hook run; keep them where they worked.
  for (const { hook, added } of await migrateHookRequires(
    globalHooksJsonPath()
  ))
    console.log(
      chalk.green(
        `  ✓ ~/.spec-lite/hooks.json: "${hook}" now runs only on runs that carry ${added.join(" and ")} ("requires")`
      )
    );

  // 5. Write global config
  const pkg = getPackageVersion();
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
  console.log(
    chalk.bold(
      `\n  Done! ${written} files written globally across ${providers.length} provider(s).`
    )
  );

  for (const provider of providers) {
    if (provider.getGlobalPostInstallMessage) {
      console.log(provider.getGlobalPostInstallMessage());
    }
  }

  if (hasPromptName(installedPrompts, "plan_critic")) {
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
