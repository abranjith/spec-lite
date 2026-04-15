import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import inquirer from "inquirer";
import { getProvider, getAllProviders } from "../providers/index.js";
import type { SpecLiteConfig, ProjectProfile } from "../providers/base.js";
import { loadPrompts, loadAllSources, replaceProjectContext } from "../utils/prompts.js";
import { generateClaudeRootMd } from "../providers/claude-code.js";
import { mergeCopilotInstructions } from "../providers/copilot.js";
import { getStackSnippetInfo } from "../utils/stacks.js";

interface InitOptions {
  ai?: string;
  exclude?: string;
  force?: boolean;
  skipProfile?: boolean;
}

interface ProjectProfileAnswers {
  languages: string[];
  languageOther?: string;
  frameworks: string;
  testFrameworks: string;
  architectures: string[];
  architectureOther?: string;
  conventions: string;
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

function parseCommaSeparatedList(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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

function mergeSelectedValues(selected: string[], otherInput?: string): string[] {
  return dedupeValues([
    ...selected.filter((value) => value !== "__other__"),
    ...parseCommaSeparatedList(otherInput ?? ""),
  ]);
}

function formatProfileValues(values: string[], fallback: string): string {
  return values.length > 0 ? values.join(", ") : fallback;
}

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

  const answers = await inquirer.prompt<ProjectProfileAnswers>([
    {
      type: "checkbox",
      name: "languages",
      message: "Programming language(s) used in this repo?",
      choices: LANGUAGE_CHOICES,
      validate: (input: string[]) =>
        input.length > 0 ? true : "Select at least one language.",
    },
    {
      type: "input",
      name: "languageOther",
      message: "Specify any other language(s), comma-separated:",
      when: (prev: ProjectProfileAnswers) =>
        Array.isArray(prev.languages) && prev.languages.includes("__other__"),
      validate: (input: string) =>
        input.trim() ? true : "Please enter at least one language.",
    },
    {
      type: "input",
      name: "frameworks",
      message:
        'Framework(s) in use? Enter one or more, comma-separated (e.g., "Express, React", "FastAPI", "ASP.NET Core")',
      default: "",
    },
    {
      type: "input",
      name: "testFrameworks",
      message:
        'Testing framework(s)? Enter one or more, comma-separated (e.g., "Jest", "Vitest", "pytest", "xUnit")',
      default: "",
    },
    {
      type: "checkbox",
      name: "architectures",
      message: "Architecture pattern(s) present in this repo?",
      choices: ARCHITECTURE_CHOICES,
      validate: (input: string[]) =>
        input.length > 0 ? true : "Select at least one architecture pattern.",
    },
    {
      type: "input",
      name: "architectureOther",
      message: "Specify any other architecture pattern(s), comma-separated:",
      when: (prev: ProjectProfileAnswers) =>
        Array.isArray(prev.architectures) && prev.architectures.includes("__other__"),
      validate: (input: string) =>
        input.trim() ? true : "Please enter at least one pattern.",
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
    languages: mergeSelectedValues(answers.languages ?? [], answers.languageOther),
    frameworks: dedupeValues(parseCommaSeparatedList(answers.frameworks)),
    testFrameworks: dedupeValues(
      parseCommaSeparatedList(answers.testFrameworks)
    ),
    architectures: mergeSelectedValues(
      answers.architectures ?? [],
      answers.architectureOther
    ),
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
    `- **Language(s)**: ${formatProfileValues(profile.languages, "Not specified")}`,
    `- **Framework(s)**: ${formatProfileValues(profile.frameworks, "None / not sure yet")}`,
    `- **Test Framework(s)**: ${formatProfileValues(profile.testFrameworks, "Not decided yet")}`,
    `- **Architecture Pattern(s)**: ${formatProfileValues(profile.architectures, "Not specified")}`,
  ];
  if (profile.conventions) {
    lines.push(`- **Conventions**: ${profile.conventions}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Build a seeded .spec-lite/memory.md from raw content scraped from a provider's
 * existing instructions file (e.g. copilot-instructions.md, CLAUDE.md).
 * The file is intentionally unstructured — /memorize bootstrap will organize it.
 */
function buildSeededMemory(
  sourceContent: string,
  sourcePath: string,
  version: string
): string {
  const date = new Date().toISOString().split("T")[0];
  return [
    `<!-- Generated by spec-lite v${version} | sub-agent: memorize | seeded-from: ${sourcePath} | updated: ${date} -->`,
    "",
    "# Memory — Standing Instructions",
    "",
    `> These instructions were **auto-seeded** from \`${sourcePath}\` during \`spec-lite init\`.`,
    "> They have not yet been organized into sections.",
    "> Run \`/memorize bootstrap\` in your AI assistant to review, reorganize, and refine them.",
    ">",
    "> Memory is the **authoritative source** for coding standards, architecture, testing, logging, and security.",
    "> Plans may contain plan-specific overrides but should not duplicate these rules.",
    "> Managed by the Memorize sub-agent. Do not edit section headers manually.",
    "> To add or change instructions, invoke: `/memorize <your instructions>`",
    "> To override: `/memorize override <your instructions>`",
    "> To generate from project analysis: `/memorize bootstrap`",
    "",
    `<!-- seed-start: raw content imported from ${sourcePath} -->`,
    "",
    `## Imported from \`${sourcePath}\``,
    "",
    sourceContent.trim(),
    "",
    "<!-- seed-end -->",
    "",
  ].join("\n");
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

  // 3b. Capture pre-existing seed content (before we write anything to the provider's instructions file)
  const memorySeedSource = await provider.getMemorySeedSource(cwd);
  let preSeedContent: string | null = null;
  if (memorySeedSource) {
    const seedAbsPath = path.join(cwd, memorySeedSource.path);
    if (await fs.pathExists(seedAbsPath)) {
      preSeedContent = await fs.readFile(seedAbsPath, "utf-8");
    }
  }

  // 4. Check for existing files
  const existingFiles = await provider.detectExisting(cwd);
  let globalAction: "overwrite" | "skip" | null = null;

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

    globalAction = answer.action as "overwrite" | "skip";

    if (globalAction === "skip") {
      console.log(chalk.dim("  Skipping existing files."));
    }
  }

  // 5. Build project context block (if profile was collected)
  const contextBlock = projectProfile
    ? buildProjectContextBlock(projectProfile)
    : null;

  // 6. Load and write prompts (new agents/skills structure with legacy fallback)
  const sources = await loadAllSources(exclude);
  let written = 0;
  let skipped = 0;
  const installedPrompts: string[] = [];

  for (const source of sources) {
    const meta = {
      name: source.promptName,
      title: source.title,
      description: source.description,
    };
    const paths = provider.getOutputPaths(source.name);

    // --- Agent file (if provider supports agents and path is present) ---
    if (paths.agent && provider.supportsAgents && provider.transformAgent) {
      const agentAbsPath = path.join(cwd, paths.agent);

      const shouldSkipAgent =
        !options.force &&
        existingFiles.includes(paths.agent) &&
        globalAction === "skip";

      if (!shouldSkipAgent) {
        let content = source.content;
        if (contextBlock) {
          content = replaceProjectContext(content, contextBlock);
        }
        const transformed = provider.transformAgent(content, meta);
        await fs.ensureDir(path.dirname(agentAbsPath));
        await fs.writeFile(agentAbsPath, transformed, "utf-8");
        written++;
        console.log(chalk.green(`  ✓ ${paths.agent}`));
      } else {
        skipped++;
      }
    }

    // --- Prompt file ---
    const promptAbsPath = path.join(cwd, paths.prompt);

    const shouldSkipPrompt =
      !options.force &&
      existingFiles.includes(paths.prompt) &&
      globalAction === "skip";

    if (!shouldSkipPrompt) {
      let content = source.content;
      if (contextBlock) {
        content = replaceProjectContext(content, contextBlock);
      }
      const transformed = provider.transformPrompt(content, meta);
      await fs.ensureDir(path.dirname(promptAbsPath));
      await fs.writeFile(promptAbsPath, transformed, "utf-8");
      written++;
      console.log(chalk.green(`  ✓ ${paths.prompt}`));
    } else {
      skipped++;
    }

    installedPrompts.push(source.name);
  }

  // 7. Provider-specific extras
  if (provider.alias === "claude-code") {
    const claudeMdPath = path.join(cwd, "CLAUDE.md");
    const claudeMdContent = generateClaudeRootMd(installedPrompts);
    await fs.writeFile(claudeMdPath, claudeMdContent, "utf-8");
    console.log(chalk.green(`  ✓ CLAUDE.md`));
    written++;
  }

  if (provider.alias === "copilot") {
    // Write / update .github/copilot-instructions.md
    const copilotInstructionsPath = path.join(cwd, ".github", "copilot-instructions.md");
    await fs.ensureDir(path.join(cwd, ".github"));
    const existingContent = (await fs.pathExists(copilotInstructionsPath))
      ? await fs.readFile(copilotInstructionsPath, "utf-8")
      : null;
    const merged = mergeCopilotInstructions(existingContent, installedPrompts);
    await fs.writeFile(copilotInstructionsPath, merged, "utf-8");
    if (existingContent) {
      console.log(chalk.green(`  ✓ .github/copilot-instructions.md (updated with spec-lite block)`));
    } else {
      console.log(chalk.green(`  ✓ .github/copilot-instructions.md`));
    }
    written++;
  }

  // 8. Create .spec-lite/ directory structure for agent outputs
  const specDirs = [
    path.join(".spec-lite", "features"),
    path.join(".spec-lite", "reviews"),
  ];
  for (const dir of specDirs) {
    const absDir = path.join(cwd, dir);
    if (!(await fs.pathExists(absDir))) {
      await fs.ensureDir(absDir);
      console.log(chalk.green(`  ✓ ${dir}/`));
    }
  }

  // 8b. Create .spec-lite/TODO.md skeleton
  const todoPath = path.join(cwd, ".spec-lite", "TODO.md");
  if (!(await fs.pathExists(todoPath))) {
    const todoContent = [
      "# TODO — Enhancements & Ideas",
      "",
      "> Discovered by sub-agents during planning and development.",
      "> Items here are out-of-scope for their current task but worth tracking.",
      "",
      "## General",
      "",
      "## Business Features",
      "",
      "## User Experience",
      "",
      "## Security",
      "",
      "## Performance",
      "",
    ].join("\n");
    await fs.writeFile(todoPath, todoContent, "utf-8");
    console.log(chalk.green(`  ✓ .spec-lite/TODO.md`));
  }

  // 9. Copy bundled stack snippets to .spec-lite/stacks/ (if profile was collected)
  if (projectProfile) {
    const stacksTargetDir = path.join(cwd, ".spec-lite", "stacks");
    const installedSnippetFiles = new Set<string>();

    for (const language of projectProfile.languages) {
      const snippet = getStackSnippetInfo(language);

      if (!snippet || installedSnippetFiles.has(snippet.fileName)) {
        continue;
      }

      installedSnippetFiles.add(snippet.fileName);
      await fs.ensureDir(stacksTargetDir);

      const snippetPath = path.join(stacksTargetDir, snippet.fileName);

      if (await fs.pathExists(snippetPath) && !options.force) {
        console.log(
          chalk.dim(`  – .spec-lite/stacks/${snippet.fileName} already exists (kept your edits)`)
        );
        continue;
      }

      await fs.writeFile(snippetPath, snippet.content, "utf-8");
      console.log(chalk.green(`  ✓ .spec-lite/stacks/${snippet.fileName}`));
      console.log(
        chalk.dim("     ↳ Edit this file to customize defaults before running /memorize bootstrap")
      );
      written++;
    }
  }

  // 9b. Offer to seed .spec-lite/memory.md from pre-existing provider instructions
  let memorySeedWritten = false;
  const memoryPath = path.join(cwd, ".spec-lite", "memory.md");
  if (preSeedContent && memorySeedSource && !(await fs.pathExists(memoryPath))) {
    console.log(
      chalk.cyan(`\n  💡 Found existing ${memorySeedSource.label} (${memorySeedSource.path}).`)
    );
    const seedAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "seedMemory",
        message: `Seed .spec-lite/memory.md from it so /memorize bootstrap can refine your existing conventions?`,
        default: true,
      },
    ]);
    if (seedAnswer.seedMemory) {
      const seedPkg = await loadPackageVersion();
      const seededContent = buildSeededMemory(preSeedContent, memorySeedSource.path, seedPkg);
      await fs.ensureDir(path.join(cwd, ".spec-lite"));
      await fs.writeFile(memoryPath, seededContent, "utf-8");
      memorySeedWritten = true;
      written++;
      console.log(chalk.green(`  ✓ .spec-lite/memory.md (seeded from ${memorySeedSource.path})`));
      console.log(chalk.dim("     ↳ Run /memorize bootstrap to organize and refine into standing instructions"));
    }
  }

  // 10. Write .spec-lite.json config
  const pkg = await loadPackageVersion();
  const config: SpecLiteConfig = {
    version: pkg,
    format: "v2",
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

  if (installedPrompts.includes("plan_critic")) {
    let planCriticNote: string | undefined;

    switch (provider.alias) {
      case "copilot":
        planCriticNote =
          "  💡 Optional checkpoint: run /spec.plan_critic .spec-lite/plan.md in Copilot Chat before implementation to pressure-test the plan.";
        break;
      case "claude-code":
        planCriticNote =
          "  💡 Optional checkpoint: ask Claude Code to use .claude/agents/spec.plan_critic.md against .spec-lite/plan.md before implementation.";
        break;
      case "pi":
        planCriticNote =
          "  💡 Optional checkpoint: run /spec.plan_critic .spec-lite/plan.md in Pi Chat before implementation.";
        break;
      case "generic":
        planCriticNote =
          "  💡 Optional checkpoint: copy .spec-lite/prompts/spec.plan_critic.md into your LLM and review .spec-lite/plan.md before implementation.";
        break;
    }

    if (planCriticNote) {
      console.log(chalk.cyan(`\n${planCriticNote}`));
    }
  }

  // 12. Bootstrap next-step guidance
  if (projectProfile || memorySeedWritten) {
    if (memorySeedWritten) {
      console.log(
        chalk.cyan(
          "\n  📌 Next step: Run ") +
          chalk.bold("/memorize bootstrap") +
          chalk.cyan(
            " in your AI assistant.\n     It will see your seeded memory and offer to merge or refine it\n     into properly organized standing instructions."
          )
      );
    } else {
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
