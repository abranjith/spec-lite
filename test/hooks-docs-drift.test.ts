import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderVarsTable,
  renderEventsTable,
  extractBetweenMarkers,
  VARS_TABLE_START,
  VARS_TABLE_END,
  EVENTS_TABLE_START,
  EVENTS_TABLE_END,
  renderBuiltinHooksJson,
  renderGitWorkflowHooksJson,
  BUILTIN_HOOKS_START,
  BUILTIN_HOOKS_END,
  GIT_WORKFLOW_HOOKS_START,
  GIT_WORKFLOW_HOOKS_END,
} from "../src/hooks/docs.js";
import { INTERPOLATION_VARS } from "../src/hooks/interpolation.js";
import { EVENT_CATALOG } from "../src/hooks/events.js";
import { loadRegistry } from "../src/hooks/registry.js";
import os from "node:os";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docPath = path.join(repoRoot, "docs", "features", "hooks.md");

async function hooksDoc(): Promise<string> {
  return fs.readFile(docPath, "utf-8");
}

describe("docs/features/hooks.md tables do not drift from the code", () => {
  it("has both marker pairs", async () => {
    const content = await hooksDoc();
    expect(content).toContain(VARS_TABLE_START);
    expect(content).toContain(VARS_TABLE_END);
    expect(content).toContain(EVENTS_TABLE_START);
    expect(content).toContain(EVENTS_TABLE_END);
  });

  it("interpolation table matches INTERPOLATION_VARS", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), VARS_TABLE_START, VARS_TABLE_END);
    expect(
      embedded,
      "hooks.md vars table is stale — run `npm run generate:hook-docs`"
    ).toBe(renderVarsTable());
  });

  it("event table matches EVENT_CATALOG", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), EVENTS_TABLE_START, EVENTS_TABLE_END);
    expect(
      embedded,
      "hooks.md events table is stale — run `npm run generate:hook-docs`"
    ).toBe(renderEventsTable());
  });

  it.each([
    ["builtin hook definitions", BUILTIN_HOOKS_START, BUILTIN_HOOKS_END, renderBuiltinHooksJson],
    ["Git workflow hook entries", GIT_WORKFLOW_HOOKS_START, GIT_WORKFLOW_HOOKS_END, renderGitWorkflowHooksJson],
  ] as const)("%s match the shipped builtins", async (_label, start, end, render) => {
    const embedded = extractBetweenMarkers(await hooksDoc(), start, end);
    expect(embedded, "hooks.md hook JSON is stale — run `npm run generate:hook-docs`").toBe(render());
  });

  it("documents a Git workflow setup that validates cleanly", async () => {
    const doc = await hooksDoc();
    const json = (block: string) => JSON.parse(block.replace(/^```json\n|\n```$/g, ""));
    const settings = /#### Settings\n[\s\S]*?```json\n([\s\S]*?)\n```/.exec(doc)?.[1];
    const entries = extractBetweenMarkers(doc, GIT_WORKFLOW_HOOKS_START, GIT_WORKFLOW_HOOKS_END) ?? "";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-docs-"));
    try {
      await fs.outputJson(path.join(root, ".spec-lite.json"), JSON.parse(settings ?? "null"));
      await fs.outputJson(path.join(root, ".spec-lite", "hooks.json"), json(entries));
      const { hooks, issues } = await loadRegistry(root);
      expect(issues).toEqual([]);
      expect(hooks.map((hook) => hook.name)).toEqual(expect.arrayContaining(["prepare-worktree", "commit-progress", "create-pull-request"]));
    } finally {
      await fs.remove(root);
    }
  });

  it("documents every interpolation variable, with no extras", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), VARS_TABLE_START, VARS_TABLE_END) ?? "";
    for (const v of INTERPOLATION_VARS) {
      expect(embedded, `\${${v.name}} is missing from the hooks.md table`).toContain(`\`\${${v.name}}\``);
    }
    // `${env:NAME}` is documented as a row but is not a table entry, so the
    // doc carries exactly one more row than INTERPOLATION_VARS.
    const rowCount = embedded.split("\n").filter((l) => l.startsWith("| `")).length;
    expect(rowCount).toBe(INTERPOLATION_VARS.length + 1);
  });

  it("documents every catalog event", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), EVENTS_TABLE_START, EVENTS_TABLE_END) ?? "";
    for (const e of EVENT_CATALOG) {
      expect(embedded, `${e.name} is missing from the hooks.md event table`).toContain(`\`${e.name}\``);
    }
  });
});
