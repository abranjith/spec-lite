import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROMPT_CATALOG,
  PROMPT_NAMES,
  classifyItem,
} from "../src/utils/prompts.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = path.join(repoRoot, "agents");
const skillsRoot = path.join(repoRoot, "skills");
const referencesRoot = path.join(repoRoot, "references");

const normalizeName = (name: string): string => name.replace(/-/g, "_");

async function directoryNames(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function markdownFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(fullPath);
    }
  }

  await walk(root);
  return result;
}

function extractSection(content: string, heading: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(`${heading}\n`);
  if (start === -1) return null;
  const bodyStart = start + heading.length + 1;
  const nextHeading = normalized.indexOf("\n## ", bodyStart);
  return normalized.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading).trim();
}

const canonicalProjectTools =
  "If `.spec-lite/tools/` exists, list it, read each script's header comment, and run relevant tools to gather live context before and during work. Never modify those tools; use the **Tool Helper** skill for changes.";

const canonicalEnhancementTracking =
  "Do not expand the current scope. Append out-of-scope improvements to `.spec-lite/TODO.md` as `- [ ] <description> (discovered during: <context>)`, then notify the user.";

describe("source catalog", () => {
  it("contains every source exactly once with the correct kind", async () => {
    const agentNames = (await directoryNames(agentsRoot)).map(normalizeName);
    const skillNames = (await directoryNames(skillsRoot)).map(normalizeName);
    const referenceNames = (await fs.readdir(referencesRoot))
      .filter((name) => name.endsWith(".md"))
      .map((name) => normalizeName(path.basename(name, ".md")));
    const expectedNames = [...agentNames, ...skillNames, ...referenceNames].sort();

    expect(Object.keys(PROMPT_NAMES).sort()).toEqual(expectedNames);
    expect(Object.keys(PROMPT_CATALOG).sort()).toEqual(expectedNames);

    for (const name of agentNames) expect(classifyItem(name)).toBe("agent");
    for (const name of skillNames) expect(classifyItem(name)).toBe("skill");
    for (const name of referenceNames) expect(classifyItem(name)).toBe("reference");
  });
});

describe("markdown source integrity", () => {
  it("has no dangling relative markdown links", async () => {
    const files = [
      ...(await markdownFiles(agentsRoot)),
      ...(await markdownFiles(skillsRoot)),
      ...(await markdownFiles(referencesRoot)),
    ];
    const dangling: string[] = [];
    const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      for (const match of content.matchAll(markdownLink)) {
        const rawTarget = match[1].trim().replace(/^<|>$/g, "");
        const target = rawTarget.split("#", 1)[0];
        if (
          !target.toLowerCase().endsWith(".md") ||
          /^(?:[a-z]+:|\/)/i.test(target) ||
          target.includes("<") ||
          target.includes("{{") ||
          target.startsWith(".spec-lite/")
        ) {
          continue;
        }

        const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
        if (!(await fs.pathExists(resolved))) {
          dangling.push(`${path.relative(repoRoot, file)} -> ${target}`);
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it("keeps canonical shared sections byte-identical", async () => {
    const files = [
      ...(await markdownFiles(agentsRoot)),
      ...(await markdownFiles(skillsRoot)),
    ];
    const drift: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      const projectTools = extractSection(content, "## Project Tools");
      if (projectTools !== null && projectTools !== canonicalProjectTools) {
        drift.push(`${path.relative(repoRoot, file)}: Project Tools`);
      }
      const enhancements = extractSection(content, "## Enhancement Tracking");
      if (enhancements !== null && enhancements !== canonicalEnhancementTracking) {
        drift.push(`${path.relative(repoRoot, file)}: Enhancement Tracking`);
      }
    }

    const orchestrator = await fs.readFile(
      path.join(referencesRoot, "orchestrator.md"),
      "utf8",
    );
    expect(orchestrator).toContain(canonicalProjectTools);
    expect(orchestrator).toContain(canonicalEnhancementTracking);
    expect(drift).toEqual([]);
  });

  it("includes project-context markers in every agent and skill", async () => {
    const rootFiles = [
      ...(await directoryNames(agentsRoot)).map((name) => path.join(agentsRoot, name, "AGENT.md")),
      ...(await directoryNames(skillsRoot)).map((name) => path.join(skillsRoot, name, "SKILL.md")),
    ];
    const missing: string[] = [];

    for (const file of rootFiles) {
      const content = await fs.readFile(file, "utf8");
      if (
        !content.includes("<!-- project-context-start -->") ||
        !content.includes("<!-- project-context-end -->")
      ) {
        missing.push(path.relative(repoRoot, file));
      }
    }

    expect(missing).toEqual([]);
  });
});
