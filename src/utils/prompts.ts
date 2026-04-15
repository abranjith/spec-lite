import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import type { SourceItem, SourceItemKind } from "../providers/base.js";
import { loadAllAgents } from "./agents.js";
import { loadAllSkills } from "./skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the bundled prompts directory (legacy — shipped with the npm package) */
export function getPromptsDir(): string {
  // In the built output (tsup bundles to dist/index.js),
  // __dirname resolves to dist/ — prompts/ is one level up at the package root
  return path.resolve(__dirname, "..", "prompts");
}

/** Path to the bundled references directory (shipped with the npm package) */
export function getReferencesDir(): string {
  return path.resolve(__dirname, "..", "references");
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
  // Try exact match first, then try underscore variant (for hyphenated new-style names)
  const entry = PROMPT_NAMES[internalName] ?? PROMPT_NAMES[internalName.replace(/-/g, "_")];
  return entry?.promptName ?? internalName.replace(/-/g, "_");
}

/** Get the noun-form output name for an agent file. Falls back to prompt name. */
export function getAgentOutputName(internalName: string): string {
  const entry = PROMPT_NAMES[internalName] ?? PROMPT_NAMES[internalName.replace(/-/g, "_")];
  return entry?.agentName ?? getPromptOutputName(internalName);
}

/** Check whether a prompt is prompt-only (no dedicated agent file in non-Copilot providers). */
export function isPromptOnly(internalName: string): boolean {
  const entry = PROMPT_NAMES[internalName] ?? PROMPT_NAMES[internalName.replace(/-/g, "_")];
  return entry?.promptOnly ?? false;
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
  "brainstorm", "plan", "plan_feature", "architect", "explore", "yolo",
]);

const SKILL_ITEMS = new Set([
  "implement", "feature", "review_code", "review_security", "review_performance",
  "write_unit_tests", "write_integration_tests", "fix", "write_readme",
  "build_data_model", "devops", "tool_help", "memorize", "plan_critic", "todo",
]);

/**
 * Classify a prompt name into its source item kind.
 */
function classifyItem(name: string): SourceItemKind {
  if (REFERENCE_FILES.has(name)) return "reference";
  if (SKILL_ITEMS.has(name)) return "skill";
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
// Unified source loader (agents + skills + references, with legacy fallback)
// ---------------------------------------------------------------------------

/**
 * Load all source items: agents from agents/, skills from skills/, references from references/.
 * Falls back to legacy prompts/ for any items not found in the new structure.
 *
 * This is the primary entry point for init/install/update commands.
 */
export async function loadAllSources(
  exclude: string[] = []
): Promise<SourceItem[]> {
  const excludeSet = new Set(exclude);

  // Load from new structure
  const agents = await loadAllAgents();
  const skills = await loadAllSkills();
  const references = await loadReferences(exclude);

  // Collect names already loaded from new structure
  const loadedNames = new Set<string>([
    ...agents.map((a) => a.name),
    ...skills.map((s) => s.name),
    ...references.map((r) => r.name),
  ]);

  // Also map hyphenated names to underscored to match legacy names
  // e.g. "review-code" (new) covers "review_code" (legacy)
  const loadedLegacyNames = new Set<string>();
  for (const name of loadedNames) {
    loadedLegacyNames.add(name);
    loadedLegacyNames.add(name.replace(/-/g, "_"));
  }

  // Fall back to legacy prompts/ for anything not yet loaded
  const legacyPrompts = await loadPrompts(exclude);
  const legacyItems: SourceItem[] = [];

  for (const prompt of legacyPrompts) {
    if (loadedLegacyNames.has(prompt.name)) continue;
    if (excludeSet.has(prompt.name)) continue;

    const nameEntry = PROMPT_NAMES[prompt.name];
    const kind = classifyItem(prompt.name);

    legacyItems.push({
      kind,
      name: prompt.name,
      rootPath: prompt.filePath,
      content: prompt.content,
      title: prompt.title,
      description: prompt.description,
      promptName: nameEntry?.promptName ?? prompt.name,
      agentName: nameEntry?.agentName ?? prompt.name,
      promptOnly: nameEntry?.promptOnly ?? false,
    });
  }

  // Combine: new agents/skills/references + legacy fallbacks
  const all = [
    ...agents.filter((a) => !excludeSet.has(a.name) && !excludeSet.has(a.name.replace(/-/g, "_"))),
    ...skills.filter((s) => !excludeSet.has(s.name) && !excludeSet.has(s.name.replace(/-/g, "_"))),
    ...references,
    ...legacyItems,
  ];

  return all;
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
