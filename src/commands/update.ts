import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteConfig } from "../providers/base.js";
import {
  loadAllSources,
  extractProjectContext,
  replaceProjectContext,
  copyNativeSkillDir,
} from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";
import { mergeCopilotInstructions } from "../providers/copilot.js";

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
  const targetProviderAliases =
    requestedProviderAliases.length > 0
      ? requestedProviderAliases
      : configuredProviderAliases;

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
  console.log(
    chalk.dim(`  Installed: ${config.installedPrompts.length} prompts`)
  );

  // 2. Load latest sources (only the ones that were previously installed)
  const allSources = await loadAllSources();
  const installedAliasSet = new Set(
    config.installedPrompts.flatMap((promptName) => getPromptAliases(promptName))
  );
  const sources = allSources.filter((source) => {
    const sourceAliases = new Set<string>();
    for (const candidate of [source.name, source.promptName, source.agentName]) {
      for (const alias of getPromptAliases(candidate)) {
        sourceAliases.add(alias);
      }
    }
    return Array.from(sourceAliases).some((alias) => installedAliasSet.has(alias));
  });
  const resolvedInstalledPrompts = Array.from(
    new Set(sources.map((source) => source.name))
  );

  let updated = 0;
  let preserved = 0;
  let unchanged = 0;

  for (const provider of providers) {
    console.log(chalk.cyan(`\n  Updating prompts for ${provider.name}...`));
    const nativeSkillNames = new Set<string>();

    for (const source of sources) {
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
      if (paths.agent && provider.supportsAgents && provider.transformAgent) {
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
  }

  // 4. Update config timestamp
  config.updatedAt = new Date().toISOString();
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
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    config.version = pkg.version;
  } catch {
    // Keep existing version
  }
  await fs.writeJson(configPath, config, { spaces: 2 });

  // 5. Summary
  console.log(
    chalk.bold(
      `\n  Done! ${updated} updated, ${unchanged} unchanged, ${preserved} with preserved edits across ${providers.length} provider(s).`
    )
  );
}
