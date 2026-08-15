import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { CopilotProvider } from "../src/providers/copilot.js";
import { loadAllSources } from "../src/utils/prompts.js";
import { resolveStaleOutputPaths } from "../src/utils/stale-sources.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe("stale output cleanup", () => {
  it("finds legacy files and skill directories without deleting a reused current path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-stale-"));
    temporaryDirectories.push(root);
    await Promise.all([
      fs.outputFile(path.join(root, ".github", "agents", "spec.code_reviewer.agent.md"), "old"),
      fs.outputFile(path.join(root, ".github", "prompts", "spec.review_code.prompt.md"), "old"),
      fs.outputFile(path.join(root, ".github", "skills", "spec-review-code", "SKILL.md"), "old"),
      fs.outputFile(path.join(root, ".github", "agents", "spec.readme_writer.agent.md"), "current path"),
      fs.outputFile(path.join(root, ".github", "prompts", "spec.write_readme.prompt.md"), "old"),
    ]);

    const stale = await resolveStaleOutputPaths(root, new CopilotProvider(), await loadAllSources());

    expect(stale).toContain(".github/agents/spec.code_reviewer.agent.md");
    expect(stale).toContain(".github/prompts/spec.review_code.prompt.md");
    expect(stale).toContain(".github/skills/spec-review-code");
    expect(stale).toContain(".github/prompts/spec.write_readme.prompt.md");
    expect(stale).not.toContain(".github/agents/spec.readme_writer.agent.md");
  });
});
