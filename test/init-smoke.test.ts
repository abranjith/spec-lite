import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it, vi } from "vitest";
import { initCommand } from "../src/commands/init.js";

async function allTextFiles(root: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else chunks.push(await fs.readFile(fullPath, "utf8"));
    }
  }
  await walk(root);
  return chunks.join("\n");
}

describe("fresh provider initialization", () => {
  it("writes the v0.2 layout for every provider without legacy roles", async () => {
    const originalCwd = process.cwd();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-init-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const expected: Record<string, string[]> = {
      copilot: [
        ".github/agents/spec.planner.agent.md",
        ".github/prompts/spec.help.prompt.md",
        ".github/skills/spec-review/SKILL.md",
      ],
      "claude-code": [
        ".claude/agents/spec.planner.md",
        ".claude/commands/spec.help.md",
      ],
      codex: [
        ".codex/agents/spec.planner.toml",
        ".agents/skills/spec-review/SKILL.md",
      ],
      pi: [
        ".pi/prompts/spec.plan.md",
        ".pi/skills/spec-review/SKILL.md",
      ],
      generic: [
        ".spec-lite/prompts/spec.plan.md",
        ".spec-lite/prompts/spec.orchestrator.md",
      ],
    };

    try {
      for (const [provider, paths] of Object.entries(expected)) {
        const target = path.join(root, provider);
        await fs.ensureDir(target);
        process.chdir(target);
        await initCommand({ ai: provider, skipProfile: true, force: true });

        for (const relativePath of paths) {
          expect(await fs.pathExists(path.join(target, relativePath)), `${provider}: ${relativePath}`).toBe(true);
        }

        const config = await fs.readJson(path.join(target, ".spec-lite.json"));
        expect(config.version).toBe("0.3.0");
        expect(config.documentation).toEqual({
          directory: "docs",
          level: "technical",
          updateWithDevelopment: false,
        });
        expect(await allTextFiles(target)).not.toMatch(
          /review_security|review_performance|review_code|spec\.explore|write_readme/,
        );
      }

      expect(await fs.pathExists(path.join(root, "claude-code", ".claude", "agents", "spec.help.md"))).toBe(false);
      expect(await fs.pathExists(path.join(root, "codex", ".codex", "agents", "spec.help.toml"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      log.mockRestore();
      await fs.remove(root);
    }
  }, 60_000);
});
