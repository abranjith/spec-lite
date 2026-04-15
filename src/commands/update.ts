import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import { getProvider } from "../providers/index.js";
import type { SpecLiteConfig } from "../providers/base.js";
import {
  loadAllSources,
  extractProjectContext,
  replaceProjectContext,
} from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";
import { mergeCopilotInstructions } from "../providers/copilot.js";

interface UpdateOptions {
  force?: boolean;
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
  const provider = getProvider(config.provider);

  if (!provider) {
    console.error(
      chalk.red(
        `  Unknown provider "${config.provider}" in .spec-lite.json. Re-run "spec-lite init".`
      )
    );
    process.exit(1);
  }

  console.log(chalk.cyan(`  Provider: ${provider.name}`));
  console.log(
    chalk.dim(`  Installed: ${config.installedPrompts.length} prompts`)
  );

  // 2. Load latest sources (only the ones that were previously installed)
  const allSources = await loadAllSources();
  const installedSet = new Set(config.installedPrompts);
  // Match by both the source name and the underscore variant
  const sources = allSources.filter(
    (s) => installedSet.has(s.name) || installedSet.has(s.name.replace(/-/g, "_"))
  );

  let updated = 0;
  let preserved = 0;
  let unchanged = 0;

  for (const source of sources) {
    const meta = {
      name: source.promptName,
      title: source.title,
      description: source.description,
    };
    const paths = provider.getOutputPaths(source.name);

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

    // --- Prompt file ---
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

  // 3. Update provider-specific extras
  if (provider.alias === "claude-code") {
    const claudeMdPath = path.join(cwd, "CLAUDE.md");
    const claudeMdContent = generateClaudeRootMd(config.installedPrompts);
    await fs.writeFile(claudeMdPath, claudeMdContent, "utf-8");
    console.log(chalk.green(`  ✓ CLAUDE.md (regenerated)`));
  }

  if (provider.alias === "copilot") {
    const copilotInstructionsPath = path.join(cwd, ".github", "copilot-instructions.md");
    await fs.ensureDir(path.join(cwd, ".github"));
    const existingContent = (await fs.pathExists(copilotInstructionsPath))
      ? await fs.readFile(copilotInstructionsPath, "utf-8")
      : null;
    const merged = mergeCopilotInstructions(existingContent, config.installedPrompts);
    await fs.writeFile(copilotInstructionsPath, merged, "utf-8");
    console.log(chalk.green(`  ✓ .github/copilot-instructions.md (updated)`));
  }

  // 4. Update config timestamp
  config.updatedAt = new Date().toISOString();
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
      `\n  Done! ${updated} updated, ${unchanged} unchanged, ${preserved} with preserved edits.`
    )
  );
}
