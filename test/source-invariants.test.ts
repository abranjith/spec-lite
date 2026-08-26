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
const docsRoot = path.join(repoRoot, "docs");

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

const canonicalHooks =
  "At each marked point below, run exactly:\n\n" +
  "    spec-lite hook run <event> [--feature <FEAT-ID>] [--task <TASK-ID>] [--payload key=value ...]\n\n" +
  "using the event name given at that point, then carry out any `SPEC-LITE-DIRECTIVE` line it prints, in order, before continuing " +
  "— each one names a skill, agent, or prompt to invoke. A non-zero exit means stop: `1` when a hook with `onFailure: \"abort\"` failed, " +
  "`2` when the event name or the registry is invalid. Report it rather than continuing. Never substitute a hand-maintained file list for what a hook reports — `changeset.json` is authoritative.";

/** Roles wired to emit hooks in v1 — every other agent/skill must NOT carry ## Hooks yet. */
const hookWiredRoles = [
  "implement", "fix", "review", "feature", "plan_feature", "plan", "brainstorm",
];

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

  it("has no dangling links in README.md or the docs set", async () => {
    const files = [path.join(repoRoot, "README.md"), ...(await markdownFiles(docsRoot))];
    const dangling: string[] = [];
    const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      for (const match of content.matchAll(markdownLink)) {
        const rawTarget = match[1].trim().replace(/^<|>$/g, "");
        const target = rawTarget.split("#", 1)[0];
        // Absolute URLs, pure anchors, and runtime paths a user creates are not
        // repository files; everything else must resolve on disk.
        if (
          target === "" ||
          /^(?:[a-z]+:|\/)/i.test(target) ||
          target.startsWith(".spec-lite/") ||
          target.includes("<") ||
          target.includes("{{")
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

  it("links every docs page from the README", async () => {
    const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
    const orphans: string[] = [];

    for (const file of await markdownFiles(docsRoot)) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      if (!readme.includes(`(${relative})`)) orphans.push(relative);
    }

    expect(orphans, "add the new document to the README documentation index").toEqual([]);
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
      const hooks = extractSection(content, "## Hooks");
      if (hooks !== null && hooks !== canonicalHooks) {
        drift.push(`${path.relative(repoRoot, file)}: Hooks`);
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

  it("wires ## Hooks into exactly the v1 emitted-event roles, no more and no fewer", async () => {
    const files = [
      ...(await markdownFiles(agentsRoot)),
      ...(await markdownFiles(skillsRoot)),
    ];
    const withHooks: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (extractSection(content, "## Hooks") !== null) {
        const base = path.basename(path.dirname(file));
        withHooks.push(normalizeName(base));
      }
    }

    expect(withHooks.sort()).toEqual([...hookWiredRoles].sort());
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
