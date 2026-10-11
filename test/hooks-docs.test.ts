import { describe, expect, it } from "vitest";
import { extractBetweenMarkers, renderGitWorkflowHooksJson } from "../src/hooks/docs.js";

const start = "<!-- generated:start -->";
const end = "<!-- generated:end -->";

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
