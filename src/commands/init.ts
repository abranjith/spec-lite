import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteConfig, ProjectProfile } from "../providers/base.js";
import { loadPrompts, replaceProjectContext } from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";
import { getStackSnippet } from "../utils/stacks.js";

interface InitOptions {
  ai?: string;
  exclude?: string;
  force?: boolean;
  skipProfile?: boolean;
}

const LANGUAGE_CHOICES = [
  { name: "TypeScript", value: "TypeScript" },
  { name: "Python", value: "Python" },
  { name: "Java", value: "Java" },
  { name: "C# / .NET", value: "C#" },
  { name: "Go", value: "Go" },
  { name: "Rust", value: "Rust" },
  { name: "Other (specify below)", value: "__other__" },
];

const ARCHITECTURE_CHOICES = [
  { name: "Monolith", value: "Monolith" },
  { name: "Microservices", value: "Microservices" },
  { name: "Serverless", value: "Serverless" },
  { name: "Monorepo", value: "Monorepo" },
  { name: "Other (specify below)", value: "__other__" },
];

/**
 * Collect project profile via interactive questionnaire.
 * Returns a ProjectProfile with the user's answers.
 */
async function collectProjectProfile(): Promise<ProjectProfile> {
  console.log(
    chalk.cyan(
      "\n  📋 Project Profile — a few questions to personalize your setup:\n"
    )
  );

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "language",
      message: "Primary programming language?",
      choices: LANGUAGE_CHOICES,
    },
    {
      type: "input",
      name: "languageOther",
      message: "Specify your primary language:",
      when: (prev: Record<string, string>) => prev.language === "__other__",
      validate: (input: string) =>
        input.trim() ? true : "Please enter a language.",
    },
    {
      type: "input",
      name: "frameworks",
      message:
        'Framework(s) in use? (e.g., "Express + React", "FastAPI", "ASP.NET Core")',
      default: "None / not sure yet",
    },
    {
      type: "input",
      name: "testFramework",
      message:
        'Testing framework? (e.g., "Jest", "Vitest", "pytest", "xUnit")',
      default: "Not decided yet",
    },
    {
      type: "list",
      name: "architecture",
      message: "Architectural pattern?",
      choices: ARCHITECTURE_CHOICES,
    },
    {
      type: "input",
      name: "architectureOther",
      message: "Specify your architectural pattern:",
      when: (prev: Record<string, string>) => prev.architecture === "__other__",
      validate: (input: string) =>
        input.trim() ? true : "Please enter a pattern.",
    },
    {
      type: "input",
      name: "conventions",
      message:
        'Any specific coding conventions? (e.g., "Airbnb style guide", "PEP 8") — leave blank if none',
      default: "",
    },
  ]);

  return {
    language:
      answers.language === "__other__"
        ? answers.languageOther.trim()
        : answers.language,
    frameworks: answers.frameworks.trim(),
    testFramework: answers.testFramework.trim(),
    architecture:
      answers.architecture === "__other__"
        ? answers.architectureOther.trim()
        : answers.architecture,
    conventions: answers.conventions.trim(),
  };
}

/**
 * Build a Project Context block string from a ProjectProfile.
 * This replaces the placeholder content inside <!-- project-context-start/end --> markers.
 */
function buildProjectContextBlock(profile: ProjectProfile): string {
  const lines = [
    "",
    "## Project Context (Customize per project)",
    "",
    "> Auto-populated by spec-lite init. Edit these values as your project evolves.",
    "",
    `- **Language(s)**: ${profile.language}`,
    `- **Framework(s)**: ${profile.frameworks}`,
    `- **Test Framework**: ${profile.testFramework}`,
    `- **Architecture**: ${profile.architecture}`,
  ];
  if (profile.conventions) {
    lines.push(`- **Conventions**: ${profile.conventions}`);
  }
  lines.push("");
  return lines.join("\n");
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

  // 2. Collect project profile (unless --skip-profile)
  let projectProfile: ProjectProfile | undefined;
  if (!options.skipProfile) {
    projectProfile = await collectProjectProfile();
    console.log(chalk.green("  ✓ Project profile collected"));
  } else {
    console.log(chalk.dim("  Skipping project profile questionnaire."));
  }

  // 3. Parse exclusions (split on commas or spaces to handle both bash and PowerShell)
  const exclude = options.exclude
    ? options.exclude.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  if (exclude.length > 0) {
    console.log(chalk.dim(`  Excluding: ${exclude.join(", ")}`));
  }

  // 4. Check for existing files
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

  // 5. Build project context block (if profile was collected)
  const contextBlock = projectProfile
    ? buildProjectContextBlock(projectProfile)
    : null;

  // 6. Load and write prompts
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

    // Inject project context into prompt if profile was collected
    let content = prompt.content;
    if (contextBlock) {
      content = replaceProjectContext(content, contextBlock);
    }

    const transformed = provider.transformPrompt(content, {
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

  // 7. Provider-specific extras
  if (provider.alias === "claude-code") {
    const claudeMdPath = path.join(cwd, "CLAUDE.md");
    const claudeMdContent = generateClaudeRootMd(installedPrompts);
    await fs.writeFile(claudeMdPath, claudeMdContent, "utf-8");
    console.log(chalk.green(`  ✓ CLAUDE.md`));
    written++;
  }

  // 8. Create .spec/ directory structure
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

  // 8b. Create .spec/TODO.md skeleton
  const todoPath = path.join(cwd, ".spec", "TODO.md");
  if (!(await fs.pathExists(todoPath))) {
    const todoContent = [
      "# TODO — Enhancements & Ideas",
      "",
      "> Discovered by sub-agents during planning and development.",
      "> Items here are out-of-scope for their current task but worth tracking.",
      "",
      "## General",
      "",
      "## General / Caching",
      "",
      "## UI",
      "",
      "## Performance",
      "",
      "## Security",
      "",
      "## DX (Developer Experience)",
      "",
    ].join("\n");
    await fs.writeFile(todoPath, todoContent, "utf-8");
    console.log(chalk.green(`  ✓ .spec/TODO.md`));
  }

  // 9. Copy bundled stack snippet to .spec-lite/stacks/ (if profile was collected)
  if (projectProfile) {
    const snippet = getStackSnippet(projectProfile.language);
    if (snippet) {
      const stacksTargetDir = path.join(cwd, ".spec-lite", "stacks");
      await fs.ensureDir(stacksTargetDir);
      const snippetFileName = `${projectProfile.language.toLowerCase().replace(/[^a-z0-9]/g, "-")}.md`;
      const snippetPath = path.join(stacksTargetDir, snippetFileName);

      if (await fs.pathExists(snippetPath) && !options.force) {
        console.log(
          chalk.dim(`  – .spec-lite/stacks/${snippetFileName} already exists (kept your edits)`)
        );
      } else {
        await fs.writeFile(snippetPath, snippet, "utf-8");
        console.log(
          chalk.green(`  ✓ .spec-lite/stacks/${snippetFileName}`)
        );
        console.log(
          chalk.dim("     ↳ Edit this file to customize defaults before running /memorize bootstrap")
        );
        written++;
      }
    }
  }

  // 10. Write .spec-lite.json config
  const pkg = await loadPackageVersion();
  const config: SpecLiteConfig = {
    version: pkg,
    provider: provider.alias,
    installedPrompts,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(projectProfile ? { projectProfile } : {}),
  };
  const configPath = path.join(cwd, ".spec-lite.json");
  await fs.writeJson(configPath, config, { spaces: 2 });
  console.log(chalk.green(`  ✓ .spec-lite.json`));

  // 11. Summary
  console.log(
    chalk.bold(
      `\n  Done! ${written} files written, ${skipped} skipped.`
    )
  );
  console.log(provider.getPostInitMessage());

  // 12. Bootstrap next-step guidance
  if (projectProfile) {
    console.log(
      chalk.cyan(
        "\n  📌 Next step: Run ") +
        chalk.bold("/memorize bootstrap") +
        chalk.cyan(
          " in your AI assistant to auto-generate\n     coding standards, architecture guidelines, and best practices\n     for your project based on the profile you just provided."
        )
    );
  }
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
