import path from "path";
import fs from "fs-extra";
import chalk from "chalk";
import { fileURLToPath } from "url";
import type { SourceItem, SourceItemKind } from "../providers/base.js";
import { loadAllAgents } from "./agents.js";
import { loadAllSkills } from "./skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the bundled references directory (shipped with the npm package) */
export function getReferencesDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "references"),
    path.resolve(__dirname, "references"),
    path.resolve(__dirname, "..", "..", "references"),
  ];
  return candidates.find((candidate) => fs.pathExistsSync(candidate)) ?? candidates[0];
}

// ---------------------------------------------------------------------------
// Prompt/Agent naming map
// ---------------------------------------------------------------------------

export interface PromptNameEntry {
  /** Verb-form name used for prompt files (e.g., "plan", "document_feature"). */
  promptName: string;
  /** Noun-form name used for agent files (e.g., "planner", "feature_documenter"). */
  agentName: string;
  /** If true, this item is a prompt only — no dedicated agent file (except Copilot which keeps agent files for handoff support). */
  promptOnly: boolean;
}

/**
 * Maps prompt names (matching the bundled .md filenames) to their
 * verb-form (prompt) and noun-form (agent) output names, plus a flag for prompt-only items.
 */
export const PROMPT_NAMES: Record<string, PromptNameEntry> = {
  help:                       { promptName: "help",                         agentName: "help",                   promptOnly: true  },
  orchestrator:               { promptName: "orchestrator",                 agentName: "orchestrator",           promptOnly: true  },
  brainstorm:                 { promptName: "brainstorm",                   agentName: "brainstormer",           promptOnly: false },
  plan:                       { promptName: "plan",                         agentName: "planner",                promptOnly: false },
  plan_critic:                { promptName: "plan_critic",                  agentName: "plan_critic",            promptOnly: false },
  todo:                       { promptName: "todo",                         agentName: "todo",                   promptOnly: false },
  feature:                    { promptName: "feature",                      agentName: "feature",                promptOnly: false },
  plan_feature:               { promptName: "plan_feature",                 agentName: "feature_planner",        promptOnly: false },
  implement:                  { promptName: "implement",                    agentName: "implementer",            promptOnly: false },
  review:                     { promptName: "review",                       agentName: "reviewer",               promptOnly: false },
  write_integration_tests:    { promptName: "write_integration_tests",      agentName: "integration_tester",     promptOnly: false },
  write_unit_tests:           { promptName: "write_unit_tests",             agentName: "unit_tester",            promptOnly: false },
  devops:                     { promptName: "devops",                       agentName: "devops",                 promptOnly: false },
  fix:                        { promptName: "fix",                          agentName: "fixer",                  promptOnly: false },
  memorize:                   { promptName: "memorize",                     agentName: "memorize",               promptOnly: false },
  document:                   { promptName: "document",                     agentName: "documenter",             promptOnly: false },
  document_feature:           { promptName: "document_feature",             agentName: "feature_documenter",     promptOnly: false },
  document_design:            { promptName: "document_design",              agentName: "design_documenter",      promptOnly: false },
  document_usage:             { promptName: "document_usage",               agentName: "usage_documenter",       promptOnly: false },
  document_readme:            { promptName: "document_readme",              agentName: "readme_writer",          promptOnly: false },
  architect:                  { promptName: "architect",                    agentName: "architect",              promptOnly: false },
  build_data_model:           { promptName: "build_data_model",             agentName: "data_model_builder",     promptOnly: false },
  yolo:                       { promptName: "yolo",                         agentName: "yolo",                   promptOnly: false },
  tool_help:                  { promptName: "tool_help",                    agentName: "tool_helper",            promptOnly: false },
};

/** Normalize a source, prompt, or CLI name to the catalog's underscore form. */
export function normalizePromptName(name: string): string {
  return name.trim().replace(/^spec[._-]/, "").replace(/-/g, "_");
}

/** Match installed prompt names regardless of their historical hyphen/underscore form. */
export function hasPromptName(installed: string[], name: string): boolean {
  const expected = normalizePromptName(name);
  return installed.some((candidate) => normalizePromptName(candidate) === expected);
}

/** Get the verb-form output name for a prompt file. Falls back to the name itself. */
export function getPromptOutputName(internalName: string): string {
  const normalized = normalizePromptName(internalName);
  return PROMPT_NAMES[normalized]?.promptName ?? normalized;
}

/** Get the noun-form output name for an agent file. Falls back to prompt name. */
export function getAgentOutputName(internalName: string): string {
  const entry = PROMPT_NAMES[normalizePromptName(internalName)];
  return entry?.agentName ?? getPromptOutputName(internalName);
}

/** Check whether a prompt is prompt-only (no dedicated agent file in non-Copilot providers). */
export function isPromptOnly(internalName: string): boolean {
  const entry = PROMPT_NAMES[normalizePromptName(internalName)];
  return entry?.promptOnly ?? false;
}

// ---------------------------------------------------------------------------
// Prompt catalog (metadata for display)
// ---------------------------------------------------------------------------

/** Map of prompt names to their human titles and descriptions */
export const PROMPT_CATALOG: Record<string, { title: string; description: string; output?: string }> = {
  help: {
    title: "Spec Help",
    description: "Lists available agents, skills, and their purpose, inputs, and outputs",
    output: "(interactive guide)",
  },
  orchestrator: {
    title: "Orchestrator",
    description: "Defines the shared workflow contracts, precedence, naming, and handoff protocols",
    output: "(agent-facing reference)",
  },
  brainstorm: {
    title: "Brainstorm",
    description: "Refines a vague idea into a clear, actionable vision",
    output: ".spec-lite/brainstorm.md",
  },
  plan: {
    title: "Planner",
    description: "Creates a detailed technical blueprint from requirements",
    output: ".spec-lite/plan.md or .spec-lite/plan_<name>.md",
  },
  plan_critic: {
    title: "Plan Critic",
    description: "Pressure-tests a plan for feasibility, technical risk, product improvements, and future adaptability",
    output: ".spec-lite/reviews/plan_critique_<scope>.md",
  },
  todo: {
    title: "TODO",
    description: "Adds user-requested backlog items to .spec-lite/TODO.md under the right category",
    output: ".spec-lite/TODO.md",
  },
  feature: {
    title: "Feature",
    description: "Breaks one feature into granular, verifiable vertical slices",
    output: ".spec-lite/features/feature_<name>.md",
  },
  plan_feature: {
    title: "Feature Planner",
    description: "Clarifies requirements and produces a single self-contained feature spec with tasks — skips the full plan",
    output: ".spec-lite/features/feature_<name>.md",
  },
  implement: {
    title: "Implement",
    description: "Picks up a feature spec and executes its tasks with code",
    output: "Working code + updated feature spec",
  },
  review: {
    title: "Review",
    description: "Audits implemented code for correctness, security, performance, and testing gaps",
    output: ".spec-lite/reviews/review_<scope>.md",
  },
  write_integration_tests: {
    title: "Integration Tests",
    description: "Writes traceable integration test scenarios from feature specs",
    output: "tests/",
  },
  write_unit_tests: {
    title: "Unit Tests",
    description: "Generates comprehensive unit tests with edge-case coverage and smart coverage exclusions",
    output: ".spec-lite/features/unit_tests_<name>.md",
  },
  devops: {
    title: "DevOps",
    description: "Sets up Docker, CI/CD, environments, and deployment",
    output: "Project infrastructure files",
  },
  fix: {
    title: "Fix & Refactor",
    description: "Debugs issues or restructures code safely",
    output: "Targeted fixes with verification",
  },
  memorize: {
    title: "Memorize",
    description:
      "Stores standing instructions that all agents and skills enforce. Use `/spec.memorize bootstrap` to auto-generate from project analysis.",
    output: ".spec-lite/memory.md",
  },
  document: {
    title: "Document",
    description: "Orchestrates full, targeted, or surgical documentation updates",
    output: "Configured documentation directory + README.md",
  },
  document_feature: {
    title: "Feature Documentation",
    description: "Writes or updates documentation for exactly one implemented feature",
    output: "<docs>/features/<feature>.md",
  },
  document_design: {
    title: "Design Documentation",
    description: "Documents the current system architecture with verified Mermaid diagrams",
    output: "<docs>/architecture.md",
  },
  document_usage: {
    title: "Usage Documentation",
    description: "Writes verified quickstart and end-user usage guidance",
    output: "<docs>/quickstart.md + <docs>/usage.md",
  },
  document_readme: {
    title: "README Documentation",
    description: "Writes the top-level README and indexes the configured documentation directory",
    output: "README.md",
  },
  architect: {
    title: "Architect",
    description:
      "Designs cloud infrastructure, database strategy, and scaling architecture with Mermaid diagrams",
    output: ".spec-lite/architect_<name>.md",
  },
  build_data_model: {
    title: "Data Modeller",
    description:
      "Designs optimized relational data models with tables, relationships, indexes, and constraints",
    output: ".spec-lite/data_model.md",
  },
  yolo: {
    title: "YOLO",
    description:
      "Autonomous end-to-end pipeline: plans → features → implement → reviews → integration tests → docs. WARNING: consumes many requests.",
    output: "Working app + .spec-lite/yolo_state.md",
  },
  tool_help: {
    title: "Tool Helper",
    description:
      "Creates and edits efficient bash tools in .spec-lite/tools/ that agents and skills auto-discover and execute",
    output: ".spec-lite/tools/<tool-name>.sh",
  },
};

/**
 * Project Context markers used to preserve user edits during updates.
 */
export const CONTEXT_START_MARKER = "<!-- project-context-start -->";
export const CONTEXT_END_MARKER = "<!-- project-context-end -->";

/**
 * Extract the Project Context block from a prompt.
 * Returns the content between markers, or null if not found.
 */
export function extractProjectContext(content: string): string | null {
  const startIdx = content.indexOf(CONTEXT_START_MARKER);
  const endIdx = content.indexOf(CONTEXT_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  return content.substring(
    startIdx + CONTEXT_START_MARKER.length,
    endIdx
  );
}

/**
 * Replace the Project Context block in a prompt with new content.
 */
export function replaceProjectContext(
  content: string,
  newContext: string
): string {
  const startIdx = content.indexOf(CONTEXT_START_MARKER);
  const endIdx = content.indexOf(CONTEXT_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return content;

  return (
    content.substring(0, startIdx + CONTEXT_START_MARKER.length) +
    newContext +
    content.substring(endIdx)
  );
}

// ---------------------------------------------------------------------------
// Native skill directory copying (shared by init + install commands)
// ---------------------------------------------------------------------------

/**
 * Copy a native Agent Skills skill directory to the target location.
 * Updates the `name` field in SKILL.md frontmatter to match the target directory name.
 * Optionally injects the project context block into the SKILL.md body.
 * Copies references/, assets/, and scripts/ subdirectories as-is.
 *
 * @returns the number of files written.
 */
export async function copyNativeSkillDir(
  sourceDir: string,
  targetDir: string,
  options: { contextBlock?: string | null }
): Promise<number> {
  let filesCopied = 0;
  const targetName = path.basename(targetDir);

  // 1. Read SKILL.md and update the name field to match output directory
  const skillMdPath = path.join(sourceDir, "SKILL.md");
  let skillContent = await fs.readFile(skillMdPath, "utf-8");

  // Update the name field in frontmatter (must match parent directory per Agent Skills spec)
  skillContent = skillContent.replace(
    /^(name:\s*).+$/m,
    `$1${targetName}`
  );

  // Inject project context if provided
  if (options.contextBlock) {
    skillContent = replaceProjectContext(skillContent, options.contextBlock);
  }

  await fs.ensureDir(targetDir);
  await fs.writeFile(path.join(targetDir, "SKILL.md"), skillContent, "utf-8");
  filesCopied++;
  const relTargetDir = path.relative(process.cwd(), targetDir);
  console.log(chalk.green(`  \u2713 ${path.join(relTargetDir, "SKILL.md")}`));

  // 2. Copy subdirectories (references/, assets/, scripts/)
  for (const subdir of ["references", "assets", "scripts"]) {
    const srcSubdir = path.join(sourceDir, subdir);
    if (!(await fs.pathExists(srcSubdir))) continue;

    const entries = await fs.readdir(srcSubdir);
    if (entries.length === 0) continue;

    const destSubdir = path.join(targetDir, subdir);
    await fs.copy(srcSubdir, destSubdir);

    for (const entry of entries) {
      filesCopied++;
      console.log(chalk.green(`  \u2713 ${path.join(relTargetDir, subdir, entry)}`));
    }
  }

  return filesCopied;
}

// ---------------------------------------------------------------------------
// References loader (standalone docs like orchestrator, help)
// ---------------------------------------------------------------------------

/** Non-agent reference files (loaded from references/ directory or legacy prompts/) */
const REFERENCE_FILES = new Set(["orchestrator", "help"]);

/**
 * Classification of existing prompts into agent vs skill categories.
 * This is used for display purposes until items are migrated to their own directories.
 */
const AGENT_ITEMS = new Set([
  "brainstorm", "plan", "plan_feature", "architect", "yolo",
]);

const SKILL_ITEMS = new Set([
  "implement", "feature", "review", "document", "document_feature",
  "document_design", "document_usage", "document_readme",
  "write_unit_tests", "write_integration_tests", "fix",
  "build_data_model", "devops", "tool_help", "memorize", "plan_critic", "todo",
]);

/**
 * Classify a prompt name into its source item kind.
 */
export function classifyItem(name: string): SourceItemKind {
  const normalized = normalizePromptName(name);
  if (REFERENCE_FILES.has(normalized)) return "reference";
  if (SKILL_ITEMS.has(normalized)) return "skill";
  return "agent";
}

/**
 * Load reference documents from the bundled references/ directory.
 * Falls back to legacy prompts/ if references/ doesn't exist.
 */
async function loadReferences(exclude: string[] = []): Promise<SourceItem[]> {
  const excludeSet = new Set(exclude);
  const references: SourceItem[] = [];

  // Try new references/ directory first
  const refsDir = getReferencesDir();
  if (await fs.pathExists(refsDir)) {
    const files = await fs.readdir(refsDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(".md", "");
      if (excludeSet.has(name)) continue;

      const filePath = path.join(refsDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const catalog = PROMPT_CATALOG[name];
      const nameEntry = PROMPT_NAMES[name];

      references.push({
        kind: "reference",
        name,
        rootPath: filePath,
        content,
        title: catalog?.title ?? name,
        description: catalog?.description ?? "",
        promptName: nameEntry?.promptName ?? name,
        agentName: nameEntry?.agentName ?? name,
        promptOnly: true, // references are always prompt-only
      });
    }
  }

  return references;
}

// ---------------------------------------------------------------------------
// Unified source loader (agents + skills + references)
// ---------------------------------------------------------------------------

/**
 * Load all source items: agents from agents/, skills from skills/, references from references/.
 *
 * This is the primary entry point for init/install/update commands.
 */
export async function loadAllSources(
  exclude: string[] = []
): Promise<SourceItem[]> {
  const excludeSet = new Set(exclude);

  const agents = await loadAllAgents();
  const skills = await loadAllSkills();
  const references = await loadReferences(exclude);

  const all = [
    ...agents.filter((a) => !excludeSet.has(a.name) && !excludeSet.has(a.name.replace(/-/g, "_"))),
    ...skills.filter((s) => !excludeSet.has(s.name) && !excludeSet.has(s.name.replace(/-/g, "_"))),
    ...references,
  ];

  return all.map((source) => {
    const normalized = normalizePromptName(source.name);
    const names = PROMPT_NAMES[normalized];
    const catalog = PROMPT_CATALOG[normalized];
    return {
      ...source,
      title: catalog?.title ?? source.title,
      description: catalog?.description ?? source.description,
      promptName: names?.promptName ?? normalized,
      agentName: names?.agentName ?? normalized,
      promptOnly: names?.promptOnly ?? source.promptOnly,
    };
  });
}

/**
 * Get the catalog for display, enhanced with kind information from loaded sources.
 * This merges the static PROMPT_CATALOG with dynamic source item data.
 */
export function getSourceCatalog(): Record<string, {
  title: string;
  description: string;
  output?: string;
  kind?: SourceItemKind;
}> {
  // Start with the static catalog and add kind info from PROMPT_NAMES
  const catalog: Record<string, {
    title: string;
    description: string;
    output?: string;
    kind?: SourceItemKind;
  }> = {};

  for (const [name, meta] of Object.entries(PROMPT_CATALOG)) {
    const kind = classifyItem(name);

    catalog[name] = { ...meta, kind };
  }

  return catalog;
}
