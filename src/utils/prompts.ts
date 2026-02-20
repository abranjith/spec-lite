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

/** Map of prompt names to their human titles and descriptions */
export const PROMPT_CATALOG: Record<string, { title: string; description: string; output?: string }> = {
  spec_help: {
    title: "Spec Help",
    description: "Lists available sub-agents, their purpose, inputs, and outputs",
    output: "(interactive guide)",
  },
  brainstorm: {
    title: "Brainstorm",
    description: "Refines a vague idea into a clear, actionable vision",
    output: ".spec/brainstorm.md",
  },
  planner: {
    title: "Planner",
    description: "Creates a detailed technical blueprint from requirements",
    output: ".spec/plan.md or .spec/plan_<name>.md",
  },
  feature: {
    title: "Feature",
    description: "Breaks one feature into granular, verifiable vertical slices",
    output: ".spec/features/feature_<name>.md",
  },
  implement: {
    title: "Implement",
    description: "Picks up a feature spec and executes its tasks with code",
    output: "Working code + updated feature spec",
  },
  code_review: {
    title: "Code Review",
    description: "Reviews code for correctness, architecture, and readability",
    output: ".spec/reviews/code_review_<name>.md",
  },
  security_audit: {
    title: "Security Audit",
    description: "Scans for vulnerabilities, misconfigurations, and security risks",
    output: ".spec/reviews/security_audit_<scope>.md",
  },
  performance_review: {
    title: "Performance Review",
    description: "Identifies bottlenecks and optimization opportunities",
    output: ".spec/reviews/performance_review_<scope>.md",
  },
  integration_tests: {
    title: "Integration Tests",
    description: "Writes traceable integration test scenarios from feature specs",
    output: "tests/",
  },
  unit_tests: {
    title: "Unit Tests",
    description: "Generates comprehensive unit tests with edge-case coverage and smart coverage exclusions",
    output: ".spec/features/unit_tests_<name>.md",
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
      "Stores standing instructions that all sub-agents enforce. Use `/memorize bootstrap` to auto-generate from project analysis.",
    output: ".spec/memory.md",
  },
  technical_docs: {
    title: "Technical Docs",
    description: "Creates deep architecture documentation for developers",
    output: "docs/technical_architecture.md",
  },
  readme: {
    title: "README",
    description: "Writes the project README and optional user guide",
    output: "README.md + docs/user_guide.md",
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
