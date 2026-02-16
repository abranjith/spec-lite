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
const PROMPT_CATALOG: Record<string, { title: string; description: string }> = {
  brainstorm: {
    title: "Brainstorm Agent",
    description: "Refines a vague idea into a clear vision",
  },
  planner: {
    title: "Planner Agent",
    description: "Creates a detailed technical blueprint",
  },
  feature: {
    title: "Feature Agent",
    description: "Breaks one feature into granular, verifiable tasks",
  },
  code_review: {
    title: "Code Review Agent",
    description: "Reviews code for correctness, architecture, readability",
  },
  security_audit: {
    title: "Security Audit Agent",
    description: "Scans for vulnerabilities and security risks",
  },
  performance_review: {
    title: "Performance Review Agent",
    description: "Identifies bottlenecks and optimization opportunities",
  },
  integration_tests: {
    title: "Integration Tests Agent",
    description: "Writes traceable test scenarios from feature specs",
  },
  devops: {
    title: "DevOps Agent",
    description: "Sets up Docker, CI/CD, environments, and deployment",
  },
  fix: {
    title: "Fix & Refactor Agent",
    description: "Debugs issues or restructures code safely",
  },
  technical_docs: {
    title: "Technical Docs Agent",
    description: "Creates architecture documentation for developers",
  },
  readme: {
    title: "README Agent",
    description: "Writes the project README and optional user guide",
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
