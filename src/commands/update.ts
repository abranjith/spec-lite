import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { detectHarnesses, getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteConfig, SourceItem } from "../providers/base.js";
import {
  loadAllSources,
  extractProjectContext,
  replaceProjectContext,
  copyNativeSkillDir,
} from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";
import { mergeCopilotInstructions } from "../providers/copilot.js";
import { mergeCodexAgentsMd } from "../providers/codex.js";
import { collectDocumentationSettings } from "../utils/documentation.js";
import { getStackSnippetInfo } from "../utils/stacks.js";
import { resolveStaleOutputPaths } from "../utils/stale-sources.js";
import { buildGroupedSourceChoices } from "../utils/source-selection.js";
import { getPackageVersion } from "../utils/package-version.js";
import { planFeatureMigration, runFeatureMigration } from "../utils/feature-migration.js";

interface UpdateOptions {
  ai?: string | string[];
  force?: boolean;
}

function normalizePromptToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^spec\./, "")
    .replace(/\.agent\.md$|\.prompt\.md$|\.md$/, "");
}

function getPromptAliases(value: string): string[] {
  const normalized = normalizePromptToken(value);
  if (!normalized) return [];

  return Array.from(
    new Set([
      normalized,
      normalized.replace(/-/g, "_"),
      normalized.replace(/_/g, "-"),
    ])
  );
}

function parseProviderAliases(input?: string | string[]): string[] {
  const rawValues = Array.isArray(input) ? input : input ? [input] : [];
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const value of rawValues) {
    for (const token of value.split(/[\s,]+/)) {
      const normalized = token.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      aliases.push(normalized);
    }
  }

  return aliases;
}

/**
 * Update a single output file: preserve project-context edits if possible,
 * otherwise overwrite.  Returns { updated, preserved, unchanged } deltas.
 */
async function updateFile(
  absPath: string,
  relPath: string,
  newContent: string,
  force: boolean
): Promise<{ updated: number; preserved: number; unchanged: number }> {
  if (!(await fs.pathExists(absPath))) {
    await fs.ensureDir(path.dirname(absPath));
    await fs.writeFile(absPath, newContent, "utf-8");
    console.log(chalk.green(`  ✓ ${relPath} (restored)`));
    return { updated: 1, preserved: 0, unchanged: 0 };
  }

  const currentContent = await fs.readFile(absPath, "utf-8");

  if (currentContent === newContent) {
    return { updated: 0, preserved: 0, unchanged: 1 };
  }

  if (!force) {
    const userContext = extractProjectContext(currentContent);
    if (userContext) {
      const mergedContent = replaceProjectContext(newContent, userContext);
      await fs.writeFile(absPath, mergedContent, "utf-8");
      console.log(chalk.green(`  ✓ ${relPath} (updated, Project Context preserved)`));
      return { updated: 1, preserved: 1, unchanged: 0 };
    }
  }

  await fs.writeFile(absPath, newContent, "utf-8");
  console.log(chalk.green(`  ✓ ${relPath} (updated)`));
  return { updated: 1, preserved: 0, unchanged: 0 };
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.bold("\n⚡ spec-lite update\n"));

  // 1. Read existing config
  const configPath = path.join(cwd, ".spec-lite.json");
  if (!(await fs.pathExists(configPath))) {
    console.error(
      chalk.red(
        '  No .spec-lite.json found. Run "spec-lite init" first.'
      )
    );
    process.exit(1);
  }

  const config: SpecLiteConfig = await fs.readJson(configPath);
  if (!config.documentation) {
    console.log(chalk.cyan("\n  Documentation settings are new in spec-lite 0.2.0."));
    config.documentation = await collectDocumentationSettings();
    await fs.writeJson(configPath, config, { spaces: 2 });
    console.log(chalk.green("  ✓ Documentation preferences saved"));
  }
  const configuredProviderAliases = Array.from(
    new Set(
      (Array.isArray(config.providers) && config.providers.length > 0
        ? config.providers
        : [config.provider]
      )
        .map((providerAlias) => providerAlias?.trim().toLowerCase())
        .filter((providerAlias): providerAlias is string => !!providerAlias)
    )
  );
  const requestedProviderAliases = parseProviderAliases(options.ai);
  let targetProviderAliases =
    requestedProviderAliases.length > 0
      ? requestedProviderAliases
      : configuredProviderAliases;

  if (requestedProviderAliases.length === 0) {
    const detections = await detectHarnesses(cwd);
    const detectedAdditions = detections.filter(
      ({ provider, detection }) =>
        detection.detected &&
        provider.alias !== "generic" &&
        !configuredProviderAliases.includes(provider.alias),
    );

    if (detectedAdditions.length > 0) {
      const detectedSet = new Set(detectedAdditions.map(({ provider }) => provider.alias));
      const candidateAliases = [
        ...configuredProviderAliases,
        ...detectedAdditions.map(({ provider }) => provider.alias),
      ];
      const { selectedProviders } = await inquirer.prompt<{ selectedProviders: string[] }>([
        {
          type: "checkbox",
          name: "selectedProviders",
          message: "Select providers for this update:",
          choices: candidateAliases.map((alias) => {
            const provider = getProvider(alias);
            return {
              name: `${provider?.name ?? alias}${detectedSet.has(alias) ? chalk.green(" (detected — not yet configured)") : ""}`,
              value: alias,
              checked: configuredProviderAliases.includes(alias),
            };
          }),
          validate: (input: string[]) => input.length > 0 || "Select at least one provider.",
        },
      ]);
      targetProviderAliases = selectedProviders;
    }
  }

  if (targetProviderAliases.length === 0) {
    console.error(
      chalk.red(
        '  No provider configured in .spec-lite.json. Run "spec-lite init" first.'
      )
    );
    process.exit(1);
  }

  const providers = targetProviderAliases.map((providerAlias) => {
    const provider = getProvider(providerAlias);
    if (!provider) {
      console.error(
        chalk.red(
          `  Unknown provider "${providerAlias}". Available: ${getAllProviders()
            .map((p) => p.alias)
            .join(", ")}`
        )
      );
      process.exit(1);
    }
    return provider;
  });

  if (requestedProviderAliases.length > 0) {
    console.log(chalk.dim(`  Targeting providers from --ai: ${targetProviderAliases.join(", ")}`));
  }
  console.log(chalk.cyan(`  Providers: ${providers.map((provider) => provider.name).join(", ")}`));
  const configuredInstalledPrompts = Array.isArray(config.installedPrompts)
    ? config.installedPrompts
    : [];
  console.log(
    chalk.dim(`  Installed: ${configuredInstalledPrompts.length} prompts`)
  );

  // 2. Load all available sources, then let user pick which to include
  const allSources = await loadAllSources();

  const staleOutputs = (
    await Promise.all(
      providers.map(async (provider) =>
        (await resolveStaleOutputPaths(cwd, provider, allSources)).map((relativePath) => ({
          provider: provider.name,
          relativePath,
        })),
      ),
    )
  ).flat();

  if (staleOutputs.length > 0) {
    console.log(chalk.yellow("\n  Legacy spec-lite outputs detected:"));
    for (const stale of staleOutputs) {
      console.log(chalk.yellow(`    - [${stale.provider}] ${stale.relativePath}`));
    }

    let removeStale = !!options.force;
    if (!options.force) {
      const answer = await inquirer.prompt<{ removeStale: boolean }>([
        {
          type: "confirm",
          name: "removeStale",
          message: "Remove these obsolete files and directories?",
          default: true,
        },
      ]);
      removeStale = answer.removeStale;
    }

    if (removeStale) {
      for (const { relativePath } of staleOutputs) {
        const absolutePath = path.resolve(cwd, relativePath);
        const relativeCheck = path.relative(cwd, absolutePath);
        if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
          throw new Error(`Refusing to remove path outside workspace: ${relativePath}`);
        }
        await fs.remove(absolutePath);
        console.log(chalk.green(`  ✓ ${relativePath} (removed obsolete output)`));
      }
    }
  }

  // 2b. Migrate flat feature_<name>.md files to <feature-id>-<name>/spec.md so
  // hooks (capture-baseline/capture-changeset) have a directory to write
  // changeset.json and hooks.log.jsonl into.
  const plannedMoves = await planFeatureMigration(cwd);
  if (plannedMoves.length > 0) {
    console.log(chalk.yellow(`\n  Feature spec layout has changed (${plannedMoves.length} to migrate):`));
    for (const move of plannedMoves) {
      console.log(chalk.yellow(`    ${move.from}  →  ${move.to}`));
    }
    console.log(chalk.dim("  Plan `Spec File` cells and feature-summary.md links will be rewritten to match."));

    let runMigration = !!options.force;
    if (!options.force) {
      const answer = await inquirer.prompt<{ runMigration: boolean }>([
        {
          type: "confirm",
          name: "runMigration",
          message: "Migrate these feature specs now?",
          default: true,
        },
      ]);
      runMigration = answer.runMigration;
    }

    if (runMigration) {
      const result = await runFeatureMigration(cwd, plannedMoves);
      for (const move of result.moved) console.log(chalk.green(`  ✓ ${move.from} → ${move.to}`));
      for (const file of result.planFilesRewritten) console.log(chalk.green(`  ✓ ${file} (Spec File links updated)`));
      if (result.featureSummaryRewritten) console.log(chalk.green("  ✓ .spec-lite/feature-summary.md (Source spec links updated)"));
    } else {
      console.log(chalk.dim("  Skipped — run `spec-lite update` again when ready."));
    }
  }

  const installedAliasSet = new Set(
    configuredInstalledPrompts.flatMap((promptName) => getPromptAliases(promptName))
  );

  function isInstalled(source: SourceItem): boolean {
    for (const candidate of [source.name, source.promptName, source.agentName]) {
      for (const alias of getPromptAliases(candidate)) {
        if (installedAliasSet.has(alias)) return true;
      }
    }
    return false;
  }

  const installedSources = allSources.filter(isInstalled);
  const missingSources = allSources.filter((s) => !isInstalled(s));

  const choices = buildGroupedSourceChoices(allSources, (source) => {
    const installed = isInstalled(source);
    return {
      // Updates should acquire newly shipped sources by default. Users can still
      // deselect anything they intentionally do not want in this workspace.
      checked: true,
      tag: installed ? "" : chalk.dim(" (new — selected)"),
    };
  });

  const { selectedNames } = await inquirer.prompt<{ selectedNames: string[] }>([
    {
      type: "checkbox",
      name: "selectedNames",
      message: `Select prompts to update/install ${chalk.dim(`(${installedSources.length} installed, ${missingSources.length} available)`)}:`,
      choices,
      pageSize: 20,
    },
  ]);

  if (selectedNames.length === 0) {
    console.log(chalk.dim("\n  Nothing selected. Aborted."));
    return;
  }

  const selectedSet = new Set(selectedNames);
  const sources = allSources.filter((s) => selectedSet.has(s.name));
  const resolvedInstalledPrompts = Array.from(selectedSet);

  let updated = 0;
  let preserved = 0;
  let unchanged = 0;

  for (const provider of providers) {
    console.log(chalk.cyan(`\n  Updating prompts for ${provider.name}...`));
    const nativeSkillNames = new Set<string>();

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
      const paths = provider.getOutputPaths(source.name);
      const isNativeSkill =
        source.kind === "skill" &&
        !!source.frontmatter &&
        provider.supportsNativeSkills &&
        !!provider.getSkillOutputDir;

      // --- Native skill directory (preserve user edits to Project Context block) ---
      if (isNativeSkill) {
        const skillOutDir = provider.getSkillOutputDir!(source.name);
        const skillAbsDir = path.join(cwd, skillOutDir);
        const skillMdAbs = path.join(skillAbsDir, "SKILL.md");

        let contextBlock: string | null = null;
        if (!options.force && (await fs.pathExists(skillMdAbs))) {
          const existing = await fs.readFile(skillMdAbs, "utf-8");
          contextBlock = extractProjectContext(existing);
        }

        const filesCopied = await copyNativeSkillDir(source.rootPath, skillAbsDir, {
          contextBlock,
        });
        updated += filesCopied;
        if (contextBlock) preserved += 1;
        for (const alias of getPromptAliases(source.name)) {
          nativeSkillNames.add(alias);
        }
      }

      // --- Agent file ---
      if (
        paths.agent &&
        provider.supportsAgents &&
        provider.transformAgent &&
        (!source.promptOnly || provider.alias === "copilot")
      ) {
        const newContent = provider.transformAgent(source.content, meta);
        const result = await updateFile(
          path.join(cwd, paths.agent),
          paths.agent,
          newContent,
          !!options.force
        );
        updated += result.updated;
        preserved += result.preserved;
        unchanged += result.unchanged;
      }

      // --- Prompt file (skip for native skills — the skill directory replaces it) ---
      if (!isNativeSkill) {
        const newPromptContent = provider.transformPrompt(source.content, meta);
        const result = await updateFile(
          path.join(cwd, paths.prompt),
          paths.prompt,
          newPromptContent,
          !!options.force
        );
        updated += result.updated;
        preserved += result.preserved;
        unchanged += result.unchanged;
      }
    }

    // 3. Update provider-specific extras
    if (provider.alias === "claude-code") {
      const claudeMdPath = path.join(cwd, "CLAUDE.md");
      const claudeMdContent = generateClaudeRootMd(resolvedInstalledPrompts);
      await fs.writeFile(claudeMdPath, claudeMdContent, "utf-8");
      console.log(chalk.green(`  ✓ CLAUDE.md (regenerated)`));
    }

    if (provider.alias === "copilot") {
      const copilotInstructionsPath = path.join(cwd, ".github", "copilot-instructions.md");
      await fs.ensureDir(path.join(cwd, ".github"));
      const existingContent = (await fs.pathExists(copilotInstructionsPath))
        ? await fs.readFile(copilotInstructionsPath, "utf-8")
        : null;
      const merged = mergeCopilotInstructions(
        existingContent,
        resolvedInstalledPrompts,
        nativeSkillNames
      );
      await fs.writeFile(copilotInstructionsPath, merged, "utf-8");
      console.log(chalk.green(`  ✓ .github/copilot-instructions.md (updated)`));
    }

    if (provider.alias === "codex") {
      // Codex skips reference items, so omit them from the AGENTS.md listing.
      const codexInstalledPrompts = sources
        .filter((s) => s.kind !== "reference")
        .map((s) => s.name);

      const agentsMdPath = path.join(cwd, "AGENTS.md");
      const existingContent = (await fs.pathExists(agentsMdPath))
        ? await fs.readFile(agentsMdPath, "utf-8")
        : null;
      const merged = mergeCodexAgentsMd(
        existingContent,
        codexInstalledPrompts,
        nativeSkillNames
      );
      await fs.writeFile(agentsMdPath, merged, "utf-8");
      console.log(chalk.green(`  ✓ AGENTS.md (updated)`));
    }
  }

  // Restore newly available stack baselines without overwriting user edits.
  if (config.projectProfile?.languages?.length) {
    const stacksTargetDir = path.join(cwd, ".spec-lite", "stacks");
    const seenSnippetFiles = new Set<string>();
    for (const language of config.projectProfile.languages) {
      const snippet = getStackSnippetInfo(language);
      if (!snippet || seenSnippetFiles.has(snippet.fileName)) continue;
      seenSnippetFiles.add(snippet.fileName);
      const snippetPath = path.join(stacksTargetDir, snippet.fileName);
      if (await fs.pathExists(snippetPath)) continue;
      await fs.ensureDir(stacksTargetDir);
      await fs.writeFile(snippetPath, snippet.content, "utf-8");
      updated++;
      console.log(chalk.green(`  ✓ .spec-lite/stacks/${snippet.fileName} (added; existing snippets preserved)`));
    }
  }

  // 4. Update config timestamp
  config.updatedAt = new Date().toISOString();
  config.format = "v2";
  if (resolvedInstalledPrompts.length > 0) {
    config.installedPrompts = resolvedInstalledPrompts;
  }
  config.providers = Array.from(
    new Set([
      ...(Array.isArray(config.providers) ? config.providers : [config.provider]),
      ...targetProviderAliases,
    ]
      .map((providerAlias) => providerAlias?.trim().toLowerCase())
      .filter((providerAlias): providerAlias is string => !!providerAlias))
  );
  if (!config.provider || !config.providers.includes(config.provider)) {
    config.provider = config.providers[0];
  }
  config.version = getPackageVersion();
  await fs.writeJson(configPath, config, { spaces: 2 });

  // 5. Summary
  console.log(
    chalk.bold(
      `\n  Done! ${updated} updated, ${unchanged} unchanged, ${preserved} with preserved edits across ${providers.length} provider(s).`
    )
  );
}
