import { describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractBetweenMarkers, renderGitWorkflowHooksJson } from "../src/hooks/docs.js";
import { loadRegistry } from "../src/hooks/registry.js";

const start = "<!-- generated:start -->";
const end = "<!-- generated:end -->";

describe("documented flow-control examples", () => {
  it("validates the complete gate and local checkpoint examples", async () => {
    const document = await fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/features/hooks.md"), "utf8");
    const registries = [...document.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      .map((match) => JSON.parse(match[1]))
      .filter((value) => value.version === 1 && Array.isArray(value.hooks)
        && value.hooks.some((hook: { name: string }) => ["verify", "plan-ready"].includes(hook.name)));
    expect(registries).toHaveLength(2);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-control-docs-"));
    const home = vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
    try {
      for (const registry of registries) {
        await fs.outputJson(path.join(root, ".spec-lite/hooks.json"), registry);
        const { issues } = await loadRegistry(root);
        expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
      }
    } finally {
      home.mockRestore();
      await fs.remove(root);
    }
  });
});

describe("generated documentation extraction", () => {
  it.each(["\n", "\r\n"])("compares tables consistently with %j line endings", (newline) => {
    const table = "| Name | Value |\n|---|---|\n| hook | enabled |";
    const doc = ["Before", start, "", table, "", end, "After"].join("\n").replace(/\n/g, newline);

    expect(extractBetweenMarkers(doc, start, end)).toBe(table);
  });

  it("handles mixed line endings without changing content or internal spacing", () => {
    const doc = `Before\r\n${start}\r\n\r\nFirst  line\r\n\n  Indented line\n${end}\nAfter`;

    expect(extractBetweenMarkers(doc, start, end)).toBe("First  line\n\n  Indented line");
  });

  it.each(["\n", "\r\n"])("returns parseable fenced JSON with %j line endings", (newline) => {
    const block = renderGitWorkflowHooksJson();
    const doc = [start, block, end].join("\n").replace(/\n/g, newline);
    const extracted = extractBetweenMarkers(doc, start, end)!;
    const json = JSON.parse(extracted.replace(/^```json\n|\n```$/g, ""));

    expect(extracted).toBe(block);
    expect(json).toMatchObject({
      version: 1,
      hooks: [
        { name: "prepare-worktree", enabled: true },
        { name: "commit-progress", enabled: true },
        { name: "create-pull-request", enabled: true },
      ],
    });
  });

  it("returns an empty string for an empty block", () => {
    expect(extractBetweenMarkers(`${start}\r\n \r\n${end}`, start, end)).toBe("");
  });

  it.each(["No markers", start, end, `${end}\r\n${start}`])("rejects missing or reversed markers: %j", (doc) => {
    expect(extractBetweenMarkers(doc, start, end)).toBeNull();
  });
});
