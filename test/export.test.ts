import { describe, expect, it } from "vitest";
import {
  buildCombinedExport,
  resolveExportSources,
} from "../src/commands/export.js";
import type { ProjectProfile } from "../src/providers/base.js";
import { loadAllSources } from "../src/utils/prompts.js";

describe("combined prompt export", () => {
  it("resolves hyphen and underscore names and rejects unknown names", async () => {
    const sources = await loadAllSources();
    const selected = resolveExportSources(sources, ["plan-feature", "document_feature"], false);
    expect(selected.map((source) => source.name)).toEqual(["plan-feature", "document-feature"]);
    expect(() => resolveExportSources(sources, ["missing-role"], false)).toThrow(/Valid names:/);
  });

  it("places orchestrator first for --all and can omit references", async () => {
    const sources = await loadAllSources();
    expect(resolveExportSources(sources, [], true)[0].name).toBe("orchestrator");
    expect(resolveExportSources(sources, [], true, false).every((source) => source.kind !== "reference")).toBe(true);
  });

  it("produces self-contained sections, anchors, and injected project context", async () => {
    const sources = await loadAllSources();
    const selected = resolveExportSources(sources, ["orchestrator", "plan", "review"], false);
    const profile: ProjectProfile = {
      languages: ["TypeScript"],
      frameworks: ["Commander"],
      testFrameworks: ["Vitest"],
      architectures: ["CLI"],
      conventions: "Strict TypeScript",
    };
    const output = await buildCombinedExport(selected, sources, profile, "2026-08-14");

    expect(output).toContain("## Table of Contents");
    expect(output.indexOf("# Reference: Orchestrator")).toBeLessThan(output.indexOf("# Agent: Planner"));
    expect(output).toContain("(#reference-orchestrator)");
    expect(output).toContain("**Language(s)**: TypeScript");
    expect(output).not.toMatch(/\]\((?!#|[a-z]+:)[^)]+\.md(?:#[^)]+)?\)/i);
    expect(output).not.toMatch(/^---\s*\n(?:name|description):/m);
  });
});
