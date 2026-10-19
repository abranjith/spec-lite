import { describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractBetweenMarkers,
  HOOK_DOCS,
  renderGitWorkflowHooksJson,
} from "../src/hooks/docs.js";
import { loadRegistry } from "../src/hooks/registry.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const start = "<!-- generated:start -->";
const end = "<!-- generated:end -->";

/** Pages whose JSON examples must parse, and validate when they are registries or hooks. */
const EXAMPLE_SOURCES = [
  HOOK_DOCS.main,
  HOOK_DOCS.gitWorkflow,
  HOOK_DOCS.control,
  "skills/hook-help/SKILL.md",
];

interface Example {
  source: string;
  registry: { version: 1; hooks: Array<Record<string, unknown>> };
}

async function registryExamples(): Promise<Example[]> {
  const examples: Example[] = [];
  for (const source of EXAMPLE_SOURCES) {
    const text = await fs.readFile(path.join(repoRoot, source), "utf8");
    for (const [, body] of text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)) {
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch (error) {
        throw new Error(
          `${source}: a json block does not parse (${(error as Error).message}):\n${body}`
        );
      }
      const object = value as Record<string, unknown>;
      if (object?.version === 1 && Array.isArray(object.hooks))
        examples.push({ source, registry: object as Example["registry"] });
      else if (
        typeof object?.name === "string" &&
        typeof object.type === "string" &&
        Array.isArray(object.events)
      )
        examples.push({ source, registry: { version: 1, hooks: [object] } });
    }
  }
  return examples;
}

describe("documented hook examples", () => {
  it("parse, and validate with no errors", async () => {
    const examples = await registryExamples();
    const hooks = examples.flatMap((e) => e.registry.hooks);
    // Guard against a vacuous pass: the gate and checkpoint examples are present.
    expect(hooks.some((hook) => hook.gate === true)).toBe(true);
    expect(hooks.some((hook) => hook.builtin === "checkpoint")).toBe(true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-docs-"));
    const home = vi
      .spyOn(os, "homedir")
      .mockReturnValue(path.join(root, "home"));
    try {
      for (const example of examples) {
        await fs.outputJson(
          path.join(root, ".spec-lite/hooks.json"),
          example.registry
        );
        const { issues } = await loadRegistry(root);
        expect(
          issues.filter((issue) => issue.level === "error"),
          `${example.source}: ${JSON.stringify(example.registry)}`
        ).toEqual([]);
      }
    } finally {
      home.mockRestore();
      await fs.remove(root);
    }
  });
});

describe("generated documentation extraction", () => {
  it.each(["\n", "\r\n"])(
    "compares tables consistently with %j line endings",
    (newline) => {
      const table = "| Name | Value |\n|---|---|\n| hook | enabled |";
      const doc = ["Before", start, "", table, "", end, "After"]
        .join("\n")
        .replace(/\n/g, newline);

      expect(extractBetweenMarkers(doc, start, end)).toBe(table);
    }
  );

  it("handles mixed line endings without changing content or internal spacing", () => {
    const doc = `Before\r\n${start}\r\n\r\nFirst  line\r\n\n  Indented line\n${end}\nAfter`;

    expect(extractBetweenMarkers(doc, start, end)).toBe(
      "First  line\n\n  Indented line"
    );
  });

  it.each(["\n", "\r\n"])(
    "returns parseable fenced JSON with %j line endings",
    (newline) => {
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
    }
  );

  it("returns an empty string for an empty block", () => {
    expect(extractBetweenMarkers(`${start}\r\n \r\n${end}`, start, end)).toBe(
      ""
    );
  });

  it.each(["No markers", start, end, `${end}\r\n${start}`])(
    "rejects missing or reversed markers: %j",
    (doc) => {
      expect(extractBetweenMarkers(doc, start, end)).toBeNull();
    }
  );
});
