import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import { getProvider } from "../providers/index.js";
import type { SpecLiteConfig } from "../providers/base.js";
import {
  loadPrompts,
  extractProjectContext,
  replaceProjectContext,
} from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";
import { CopilotProvider, mergeCopilotInstructions } from "../providers/copilot.js";

interface UpdateOptions {
  force?: boolean;
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

  // 2. Load latest prompts (only the ones that were previously installed)
  const allPrompts = await loadPrompts();
  const installedSet = new Set(config.installedPrompts);
  const prompts = allPrompts.filter((p) => installedSet.has(p.name));

  let updated = 0;
  let preserved = 0;
  let unchanged = 0;

  for (const prompt of prompts) {
    const targetRelPath = provider.getTargetPath(prompt.name);
    const targetAbsPath = path.join(cwd, targetRelPath);

    // Transform the new prompt content
    const newContent = provider.transformPrompt(prompt.content, {
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
    });

    if (!(await fs.pathExists(targetAbsPath))) {
      // File was deleted by user — re-create it
      await fs.ensureDir(path.dirname(targetAbsPath));
      await fs.writeFile(targetAbsPath, newContent, "utf-8");
      console.log(chalk.green(`  ✓ ${targetRelPath} (restored)`));
      updated++;
      continue;
    }

    // Read current installed version
    const currentContent = await fs.readFile(targetAbsPath, "utf-8");

    // Check if content is identical (no update needed)
    if (currentContent === newContent) {
      unchanged++;
      continue;
    }

    // Try to preserve user's Project Context edits
    if (!options.force) {
      const userContext = extractProjectContext(currentContent);
      if (userContext) {
        const mergedContent = replaceProjectContext(newContent, userContext);
        await fs.writeFile(targetAbsPath, mergedContent, "utf-8");
        console.log(
          chalk.green(
            `  ✓ ${targetRelPath} (updated, Project Context preserved)`
          )
        );
        preserved++;
        updated++;
        continue;
      }
    }

    // No context block found or --force — full overwrite
    await fs.writeFile(targetAbsPath, newContent, "utf-8");
    console.log(chalk.green(`  ✓ ${targetRelPath} (updated)`));
    updated++;
  }

  // 3. Update provider-specific extras
  if (provider.alias === "claude-code") {
    const claudeMdPath = path.join(cwd, "CLAUDE.md");
    const claudeMdContent = generateClaudeRootMd(config.installedPrompts);
    await fs.writeFile(claudeMdPath, claudeMdContent, "utf-8");
    console.log(chalk.green(`  ✓ CLAUDE.md (regenerated)`));
  }

  if (provider.alias === "copilot") {
    const copilotProvider = provider as CopilotProvider;

    // Update .github/prompts/<name>.prompt.md (plain prompt files, no agent frontmatter)
    for (const prompt of prompts) {
      const promptRelPath = copilotProvider.getPromptFilePath(prompt.name);
      const promptAbsPath = path.join(cwd, promptRelPath);

      const newContent = copilotProvider.transformPromptFile(prompt.content, {
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
      });

      if (!(await fs.pathExists(promptAbsPath))) {
        // File was deleted by user — re-create it
        await fs.ensureDir(path.dirname(promptAbsPath));
        await fs.writeFile(promptAbsPath, newContent, "utf-8");
        console.log(chalk.green(`  ✓ ${promptRelPath} (restored)`));
        updated++;
        continue;
      }

      const currentContent = await fs.readFile(promptAbsPath, "utf-8");

      if (currentContent === newContent) {
        unchanged++;
        continue;
      }

      // Preserve user's Project Context edits
      if (!options.force) {
        const userContext = extractProjectContext(currentContent);
        if (userContext) {
          const mergedContent = replaceProjectContext(newContent, userContext);
          await fs.writeFile(promptAbsPath, mergedContent, "utf-8");
          console.log(chalk.green(`  ✓ ${promptRelPath} (updated, Project Context preserved)`));
          preserved++;
          updated++;
          continue;
        }
      }

      await fs.writeFile(promptAbsPath, newContent, "utf-8");
      console.log(chalk.green(`  ✓ ${promptRelPath} (updated)`));
      updated++;
    }

    // Update .github/copilot-instructions.md
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
