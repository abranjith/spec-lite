import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteConfig } from "../providers/base.js";
import { loadPrompts } from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";

interface InitOptions {
  ai?: string;
  exclude?: string;
  force?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.bold("\n⚡ spec-lite init\n"));

  // 1. Resolve provider
  let providerAlias = options.ai;

  if (!providerAlias) {
    const providers = getAllProviders();
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Which AI coding assistant are you using?",
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

  console.log(chalk.cyan(`  Provider: ${provider.name}`));

  // 2. Parse exclusions (split on commas or spaces to handle both bash and PowerShell)
  const exclude = options.exclude
    ? options.exclude.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  if (exclude.length > 0) {
    console.log(chalk.dim(`  Excluding: ${exclude.join(", ")}`));
  }

  // 3. Check for existing files
  const existingFiles = await provider.detectExisting(cwd);
  if (existingFiles.length > 0 && !options.force) {
    console.log(
      chalk.yellow(
        `\n  Found existing instruction files:\n${existingFiles
          .map((f) => `    - ${f}`)
          .join("\n")}`
      )
    );

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "How should we handle existing files?",
        choices: [
          {
            name: "Overwrite — replace all existing files",
            value: "overwrite",
          },
          {
            name: "Skip — only write files that don't exist yet",
            value: "skip",
          },
          { name: "Abort — cancel initialization", value: "abort" },
        ],
      },
    ]);

    if (answer.action === "abort") {
      console.log(chalk.dim("  Aborted."));
      return;
    }

    if (answer.action === "skip") {
      // We'll skip existing files during write
      console.log(chalk.dim("  Skipping existing files."));
    }

    // For "overwrite", we just proceed normally
  }

  // 4. Load and write prompts
  const prompts = await loadPrompts(exclude);
  let written = 0;
  let skipped = 0;
  const installedPrompts: string[] = [];

  for (const prompt of prompts) {
    const targetRelPath = provider.getTargetPath(prompt.name);
    const targetAbsPath = path.join(cwd, targetRelPath);

    // Skip if file exists and user chose "skip"
    if (
      !options.force &&
      existingFiles.includes(targetRelPath) &&
      existingFiles.length > 0
    ) {
      const answer = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: `How should we handle existing files?`,
          choices: [
            { name: "Overwrite", value: "overwrite" },
            { name: "Skip", value: "skip" },
          ],
        },
      ]);
      if (answer.action === "skip") {
        skipped++;
        installedPrompts.push(prompt.name);
        continue;
      }
    }

    const transformed = provider.transformPrompt(prompt.content, {
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
    });

    await fs.ensureDir(path.dirname(targetAbsPath));
    await fs.writeFile(targetAbsPath, transformed, "utf-8");
    written++;
    installedPrompts.push(prompt.name);

    console.log(chalk.green(`  ✓ ${targetRelPath}`));
  }

  // 5. Provider-specific extras
  if (provider.alias === "claude-code") {
    const claudeMdPath = path.join(cwd, "CLAUDE.md");
    const claudeMdContent = generateClaudeRootMd(installedPrompts);
    await fs.writeFile(claudeMdPath, claudeMdContent, "utf-8");
    console.log(chalk.green(`  ✓ CLAUDE.md`));
    written++;
  }

  // 6. Create .spec/ directory structure
  const specDirs = [
    ".spec",
    path.join(".spec", "features"),
    path.join(".spec", "reviews"),
  ];
  for (const dir of specDirs) {
    const absDir = path.join(cwd, dir);
    if (!(await fs.pathExists(absDir))) {
      await fs.ensureDir(absDir);
      console.log(chalk.green(`  ✓ ${dir}/`));
    }
  }

  // 7. Write .spec-lite.json config
  const pkg = await loadPackageVersion();
  const config: SpecLiteConfig = {
    version: pkg,
    provider: provider.alias,
    installedPrompts,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const configPath = path.join(cwd, ".spec-lite.json");
  await fs.writeJson(configPath, config, { spaces: 2 });
  console.log(chalk.green(`  ✓ .spec-lite.json`));

  // 8. Summary
  console.log(
    chalk.bold(
      `\n  Done! ${written} files written, ${skipped} skipped.`
    )
  );
  console.log(provider.getPostInitMessage());
}

async function loadPackageVersion(): Promise<string> {
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json");
    return pkg.version;
  } catch {
    return "1.0.0";
  }
}
