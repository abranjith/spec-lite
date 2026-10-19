import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  extractBetweenMarkers,
  GENERATED_BLOCKS,
  GIT_WORKFLOW_HOOKS_START,
  GIT_WORKFLOW_HOOKS_END,
  HOOK_DOCS,
  OPTIONS_TABLES,
  VARS_TABLE_START,
  VARS_TABLE_END,
  EVENTS_TABLE_START,
  EVENTS_TABLE_END,
} from "../src/hooks/docs.js";
import { INTERPOLATION_VARS } from "../src/hooks/interpolation.js";
import { EVENT_CATALOG } from "../src/hooks/events.js";
import { BUILTIN_OPTIONS } from "../src/hooks/builtins/options.js";
import {
  CHECKPOINT_PROPERTIES,
  CHOICE_SCHEMA,
} from "../src/hooks/control/validation.js";
import { loadRegistry } from "../src/hooks/registry.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const readDoc = (file: string): Promise<string> =>
  fs.readFile(path.join(repoRoot, file), "utf-8");

describe("hook docs generated blocks do not drift from the code", () => {
  it.each(GENERATED_BLOCKS.map((block) => [block.label, block] as const))(
    "%s matches the code",
    async (_label, block) => {
      const embedded = extractBetweenMarkers(
        await readDoc(block.file),
        block.start,
        block.end
      );
      expect(
        embedded,
        `${block.file}: ${block.label} is stale or its markers are missing — run \`npm run generate:hook-docs\``
      ).toBe(block.render());
    }
  );

  it("documents the options of every builtin that declares some", () => {
    const documented = Object.values(OPTIONS_TABLES).flatMap(
      (table) => table.hooks
    );
    expect([...documented].sort()).toEqual(Object.keys(BUILTIN_OPTIONS).sort());
    for (const spec of Object.values(BUILTIN_OPTIONS))
      for (const [name, option] of Object.entries(spec.options))
        expect(option.description, `${name} has no description`).toMatch(/\S/);
  });

  it("documents a Git workflow setup that validates cleanly", async () => {
    const doc = await readDoc(HOOK_DOCS.gitWorkflow);
    const json = (block: string) =>
      JSON.parse(block.replace(/^```json\n|\n```$/g, ""));
    const entries =
      extractBetweenMarkers(
        doc,
        GIT_WORKFLOW_HOOKS_START,
        GIT_WORKFLOW_HOOKS_END
      ) ?? "";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-docs-"));
    try {
      await fs.outputJson(
        path.join(root, ".spec-lite", "hooks.json"),
        json(entries)
      );
      const { hooks, issues } = await loadRegistry(root);
      expect(issues).toEqual([]);
      expect(hooks.map((hook) => hook.name)).toEqual(
        expect.arrayContaining([
          "prepare-worktree",
          "commit-progress",
          "create-pull-request",
        ])
      );
    } finally {
      await fs.remove(root);
    }
  });

  it("documents every interpolation variable, with no extras", async () => {
    const embedded =
      extractBetweenMarkers(
        await readDoc(HOOK_DOCS.main),
        VARS_TABLE_START,
        VARS_TABLE_END
      ) ?? "";
    for (const v of INTERPOLATION_VARS) {
      expect(
        embedded,
        `\${${v.name}} is missing from the hooks.md table`
      ).toContain(`\`\${${v.name}}\``);
    }
    // `${env:NAME}` is documented as a row but is not a table entry, so the
    // doc carries exactly one more row than INTERPOLATION_VARS.
    const rowCount = embedded
      .split("\n")
      .filter((l) => l.startsWith("| `")).length;
    expect(rowCount).toBe(INTERPOLATION_VARS.length + 1);
  });

  it("documents every catalog event", async () => {
    const embedded =
      extractBetweenMarkers(
        await readDoc(HOOK_DOCS.main),
        EVENTS_TABLE_START,
        EVENTS_TABLE_END
      ) ?? "";
    for (const e of EVENT_CATALOG) {
      expect(
        embedded,
        `${e.name} is missing from the hooks.md event table`
      ).toContain(`\`${e.name}\``);
    }
  });

  it("documents every checkpoint choice and github field", async () => {
    const doc = await readDoc(HOOK_DOCS.control);
    const github = CHECKPOINT_PROPERTIES.github.properties as Record<
      string,
      unknown
    >;
    for (const field of [
      ...Object.keys(CHOICE_SCHEMA.properties),
      ...Object.keys(github),
    ])
      expect(doc, `${field} is not documented`).toContain(`\`${field}`);
  });
});
