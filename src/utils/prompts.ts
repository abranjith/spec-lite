import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the bundled prompts directory (shipped with the npm package) */
export function getPromptsDir(): string {
  // In the built output (tsup bundles to dist/index.js),
  // __dirname resolves to dist/ — prompts/ is one level up at the package root
  return path.resolve(__dirname, "..", "prompts");
}

/** Metadata extracted from prompt files */
export interface PromptFile {
  /** File name without extension */
  name: string;
  /** Full file path */
  filePath: string;
  /** Raw markdown content */
  content: string;
  /** Extracted title */
  title: string;
  /** Extracted description */
  description: string;
}

// ---------------------------------------------------------------------------
// Prompt/Agent naming map
// ---------------------------------------------------------------------------

export interface PromptNameEntry {
  /** Verb-form name used for prompt files (e.g., "plan", "review_code"). Matches the bundled .md filename. */
  promptName: string;
  /** Noun-form name used for agent files (e.g., "planner", "code_reviewer"). Same as promptName for prompt-only items. */
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
  brainstorm:                 { promptName: "brainstorm",                   agentName: "brainstormer",           promptOnly: false },
  plan:                       { promptName: "plan",                         agentName: "planner",                promptOnly: false },
  plan_critic:                { promptName: "plan_critic",                  agentName: "plan_critic",            promptOnly: false },
  todo:                       { promptName: "todo",                         agentName: "todo",                   promptOnly: false },
  feature:                    { promptName: "feature",                      agentName: "feature",                promptOnly: false },
  plan_feature:               { promptName: "plan_feature",                 agentName: "feature_planner",        promptOnly: false },
  implement:                  { promptName: "implement",                    agentName: "implementer",            promptOnly: false },
  review_code:                { promptName: "review_code",                  agentName: "code_reviewer",          promptOnly: false },
  review_security:            { promptName: "review_security",              agentName: "security_reviewer",      promptOnly: false },
  review_performance:         { promptName: "review_performance",           agentName: "performance_reviewer",   promptOnly: false },
  write_integration_tests:    { promptName: "write_integration_tests",      agentName: "integration_tester",     promptOnly: false },
  write_unit_tests:           { promptName: "write_unit_tests",             agentName: "unit_tester",            promptOnly: false },
  devops:                     { promptName: "devops",                       agentName: "devops",                 promptOnly: false },
  fix:                        { promptName: "fix",                          agentName: "fixer",                  promptOnly: false },
  memorize:                   { promptName: "memorize",                     agentName: "memorize",               promptOnly: true  },
  write_readme:               { promptName: "write_readme",                 agentName: "readme_writer",          promptOnly: true  },
  architect:                  { promptName: "architect",                    agentName: "architect",              promptOnly: false },
  build_data_model:           { promptName: "build_data_model",             agentName: "data_model_builder",     promptOnly: false },
  yolo:                       { promptName: "yolo",                         agentName: "yolo",                   promptOnly: false },
  explore:                    { promptName: "explore",                      agentName: "explorer",               promptOnly: false },
  tool_help:                  { promptName: "tool_help",                    agentName: "tool_helper",            promptOnly: false },
};

/** Get the verb-form output name for a prompt file. Falls back to the name itself. */
export function getPromptOutputName(internalName: string): string {
  return PROMPT_NAMES[internalName]?.promptName ?? internalName;
}

/** Get the noun-form output name for an agent file. Falls back to prompt name. */
export function getAgentOutputName(internalName: string): string {
  return PROMPT_NAMES[internalName]?.agentName ?? getPromptOutputName(internalName);
}

/** Check whether a prompt is prompt-only (no dedicated agent file in non-Copilot providers). */
export function isPromptOnly(internalName: string): boolean {
  return PROMPT_NAMES[internalName]?.promptOnly ?? false;
}

// ---------------------------------------------------------------------------
// Prompt catalog (metadata for display)
// ---------------------------------------------------------------------------

/** Map of prompt names to their human titles and descriptions */
export const PROMPT_CATALOG: Record<string, { title: string; description: string; output?: string }> = {
  help: {
    title: "Spec Help",
    description: "Lists available sub-agents, their purpose, inputs, and outputs",
    output: "(interactive guide)",
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
  review_code: {
    title: "Code Review",
    description: "Reviews code for correctness, architecture, and readability",
    output: ".spec-lite/reviews/code_review_<name>.md",
  },
  review_security: {
    title: "Security Audit",
    description: "Scans for vulnerabilities, misconfigurations, and security risks",
    output: ".spec-lite/reviews/security_audit_<scope>.md",
  },
  review_performance: {
    title: "Performance Review",
    description: "Identifies bottlenecks and optimization opportunities",
    output: ".spec-lite/reviews/performance_review_<scope>.md",
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
      "Stores standing instructions that all sub-agents enforce. Use `/spec.memorize bootstrap` to auto-generate from project analysis.",
    output: ".spec-lite/memory.md",
  },
  write_readme: {
    title: "README",
    description: "Writes the project README and optional user guide",
    output: "README.md + docs/user_guide.md",
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
  explore: {
    title: "Explore",
    description:
      "Explores an unfamiliar codebase and documents architecture, patterns, data model, features, and improvement areas. WARNING: may consume many requests on large codebases.",
    output: "README.md + TECH_SPECS.md + .spec-lite/memory.md",
  },
  tool_help: {
    title: "Tool Helper",
    description:
      "Creates and edits efficient bash tools in .spec-lite/tools/ that sub-agents auto-discover and execute",
    output: ".spec-lite/tools/<tool-name>.sh",
  },
};

/** Non-agent files to skip */
const SKIP_FILES = new Set(["orchestrator"]);

/**
 * Load all available prompt files from the bundled prompts directory.
 * Excludes non-agent files (orchestrator).
 */
export async function loadPrompts(
  exclude: string[] = []
): Promise<PromptFile[]> {
  const promptsDir = getPromptsDir();
  const excludeSet = new Set([...exclude, ...SKIP_FILES]);

  const files = await fs.readdir(promptsDir);
  const prompts: PromptFile[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const name = file.replace(".md", "");
    if (excludeSet.has(name)) continue;

    const filePath = path.join(promptsDir, file);
    const content = await fs.readFile(filePath, "utf-8");
    const catalog = PROMPT_CATALOG[name];

    prompts.push({
      name,
      filePath,
      content,
      title: catalog?.title ?? name,
      description: catalog?.description ?? "",
    });
  }

  return prompts;
}

/**
 * Get the list of all available prompt names.
 */
export function getAvailablePromptNames(): string[] {
  return Object.keys(PROMPT_CATALOG);
}

/**
 * Get the full prompt catalog (for display in CLI list command).
 */
export function getPromptCatalog(): Record<string, { title: string; description: string; output?: string }> {
  return PROMPT_CATALOG;
}

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
