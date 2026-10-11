import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/utils/frontmatter.js";

describe("frontmatter parsing", () => {
  it.each(["\n", "\r\n"])("preserves metadata and body with %j line endings", (newline) => {
    const body = `${newline}# Body${newline}${newline}---${newline}Trailing text${newline}`;
    const raw = ["---", "name: example", "description: >", "  First line", "  second line", "metadata:", "  title: Example", "  tags: [cli, ai]", "---", ""].join(newline) + body;
    expect(parseFrontmatter(raw)).toMatchObject({
      data: { name: "example", description: "First line second line\n", metadata: { title: "Example", tags: ["cli", "ai"] } },
      content: body,
    });
  });

  it.each(["", "# Plain markdown\n\n---\nText\n", "----\nText"])("preserves markdown without a YAML header: %j", (content) => {
    expect(parseFrontmatter(content)).toMatchObject({ data: {}, content });
  });

  it("handles a UTF-8 BOM", () => {
    expect(parseFrontmatter("\uFEFF---\nname: example\n---\n# Body\n")).toMatchObject({ data: { name: "example" }, content: "# Body\n" });
  });

  it.each(["---\n---\n", "---\n# Just a comment\n---\n", "---\n\n---\n"])("handles empty metadata: %j", (header) => {
    expect(parseFrontmatter(header + "# Body")).toMatchObject({ data: {}, content: "# Body" });
  });

  it("handles a header ending at EOF", () => {
    expect(parseFrontmatter("---\nname: example\n---")).toMatchObject({ data: { name: "example" }, content: "" });
    expect(parseFrontmatter("---\nname: example")).toMatchObject({ data: { name: "example" }, content: "" });
  });

  it("preserves YAML scalar types and aliases", () => {
    expect(parseFrontmatter("---\nname: example\nenabled: true\nword: no\ndate: 2026-10-10\ndefaults: &defaults\n  title: Example\nmetadata:\n  <<: *defaults\n  count: 2\n---\nBody")).toMatchObject({
      data: { name: "example", enabled: true, word: "no", date: new Date("2026-10-10"), metadata: { title: "Example", count: 2 } },
      content: "Body",
    });
  });

  it("treats precision specifiers as literal text", () => {
    expect(parseFrontmatter('---\nname: example\ndescription: "%.1000000000f"\n---\n%.1000000000e')).toMatchObject({ data: { description: "%.1000000000f" }, content: "%.1000000000e" });
  });

  it("rejects malformed YAML", () => {
    expect(() => parseFrontmatter("---\nmetadata: [unclosed\n---\nBody")).toThrow();
  });
});

describe("dependency security", () => {
  it("does not ship the unpatched sprintf-js dependency", () => {
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    const paths = Object.keys(lock.packages);
    expect(paths.filter((entry) => /(?:^|\/)node_modules\/sprintf-js$/.test(entry))).toEqual([]);
  });
});
