import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the bundled stacks directory (shipped with the npm package).
 * In the built output (tsup bundles to dist/index.js),
 * __dirname resolves to dist/ — stacks/ is copied to dist/stacks/ during build.
 */
export function getStacksDir(): string {
  return path.resolve(__dirname, "stacks");
}

/**
 * Map of language names (lowercased) to their stack snippet filenames.
 * Supports common aliases so the questionnaire answer maps correctly.
 */
const LANGUAGE_MAP: Record<string, string> = {
  typescript: "typescript.md",
  ts: "typescript.md",
  javascript: "typescript.md",
  js: "typescript.md",
  "node.js": "typescript.md",
  node: "typescript.md",
  react: "react.md",
  "react.js": "react.md",
  "next.js": "react.md",
  nextjs: "react.md",
  python: "python.md",
  py: "python.md",
  "c#": "dotnet.md",
  csharp: "dotnet.md",
  ".net": "dotnet.md",
  dotnet: "dotnet.md",
  java: "java.md",
  "spring": "java.md",
  "spring boot": "java.md",
  "spring-boot": "java.md",
  go: "go.md",
  golang: "go.md",
};

/**
 * Get the bundled best-practice snippet for a given language.
 * Returns the markdown content if a matching snippet exists, or null if not.
 */
export function getStackSnippet(language: string): string | null {
  const key = language.toLowerCase().trim();
  const filename = LANGUAGE_MAP[key];

  if (!filename) return null;

  const filePath = path.join(getStacksDir(), filename);
  if (!fs.pathExistsSync(filePath)) return null;

  return fs.readFileSync(filePath, "utf-8");
}

/**
 * List all available stack snippet names (for display purposes).
 */
export function listAvailableStacks(): string[] {
  const stacksDir = getStacksDir();
  if (!fs.pathExistsSync(stacksDir)) return [];

  return fs
    .readdirSync(stacksDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(".md", ""));
}
