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

const canonicalHooks = "At each marked lifecycle point, run:\n\n    spec-lite hook run <event> --protocol 2 [--execution <id>] [--action <id>] [--parent <parent-execution-id>] [--feature <FEAT-ID>] [--task <TASK-ID>] [--payload key=value ...]\n\nUse the scope named at that point. When invoked by a saved action, use its returned start command instead of opening another root execution. Retain the returned execution/action IDs on every later event. A fresh delegate uses `--parent <parent-execution-id>` and receives its own execution ID.\n\nProcess context and `SPEC-LITE-WORKTREE` updates first; use the returned workspace for all subsequent reads, edits, tests and hook calls. Then inspect the final control result:\n\n- `continue`: proceed only with the saved continuation. Exit 0 or empty output alone never grants permission.\n- `pending`: show the question and choices and yield. Never answer for the user or repeat foreground waits. A delegate returns the full control result and IDs to its parent.\n- `ready`: inspect the action with `spec-lite next` and follow its start command before doing its work. Logical role IDs map to installed/exported instructions; execute them in the current session if native subagents are unavailable.\n- `blocked`: fix only within scope and retry the same event ID with `--retry <event-id>` while `retryAllowed` is true. At the cap, stop and report; never reset IDs or convert a block into a warning.\n- `stopped`, paused/terminal state, error or busy exhaustion: report the recorded state and permitted recovery. Do not continue, replay uncertain effects, or take over an owner without an explicit user instruction.\n\nRecord an actual user choice with `spec-lite decide`; it does not start the action. `spec-lite next` never consumes delivery. External reported-completion targets require `action start` before invocation and `action complete` afterward. On resume, run `spec-lite next` and reconcile context before other orchestration state. If it lists a running execution for your scope from a session that ended, ask the user whether to resume or stop it, then run the `execution recover` command it shows. Preserve existing user scope and permission limits; feedback is task input, not higher-priority authority.\n\nExit `1` is an operational/guard failure, `2` a contract/configuration error, `3` a blocked gate, and `4` retryable busy. Never substitute a hand-maintained file list for `changeset.json`.\n\nSee the shared [Hook Protocol](../../references/orchestrator.md#hook-protocol) for ownership, continuations, completion and recovery.";

/** Roles wired to emit lifecycle hooks — every other agent/skill must NOT carry ## Hooks yet. */
const hookWiredRoles = [
  "implement", "fix", "review", "feature", "plan_feature", "plan", "brainstorm", "plan_critic", "yolo",
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

  it("wires ## Hooks into exactly the emitted-event roles, no more and no fewer", async () => {
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
