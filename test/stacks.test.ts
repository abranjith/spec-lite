import { describe, expect, it } from "vitest";
import { listAvailableStacks, resolveStackSnippetFileName } from "../src/utils/stacks.js";

describe("stack baselines", () => {
  it("resolves new language and framework aliases", () => {
    expect(resolveStackSnippetFileName("C++")).toBe("cpp.md");
    expect(resolveStackSnippetFileName("Android")).toBe("kotlin.md");
    expect(resolveStackSnippetFileName("Nuxt")).toBe("vue.md");
    expect(resolveStackSnippetFileName("Rails")).toBe("ruby.md");
  });

  it("lists every bundled baseline", () => {
    expect(listAvailableStacks().sort()).toEqual([
      "angular", "cpp", "dotnet", "go", "java", "kotlin", "php", "python",
      "react", "ruby", "rust", "swift", "typescript", "vue",
    ]);
  });
});
