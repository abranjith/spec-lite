import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import inquirer from "inquirer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCommand } from "../src/commands/update.js";
import { loadAllSources } from "../src/utils/prompts.js";

const context = (marker: string) =>
  `<!-- project-context-start -->\n${marker}\n<!-- project-context-end -->`;

const legacyFile = (marker: string) =>
  `<!-- spec-lite | old | managed by spec-lite -->\n# Old\n\n${context(marker)}\n\nbody\n`;

describe("pre-0.5.0 dotted outputs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renames them to Agent Skills names and keeps their Project Context", async () => {
    const originalCwd = process.cwd();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-rename-"));
    const sourceNames = (await loadAllSources()).map((source) => source.name);

    await fs.writeJson(path.join(root, ".spec-lite.json"), {
      version: "0.4.3",
      format: "v2",
      provider: "claude-code",
      providers: ["claude-code", "copilot"],
      installedPrompts: sourceNames,
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      documentation: {
        directory: "docs",
        level: "technical",
        updateWithDevelopment: false,
      },
    });
    const legacy = {
      ".claude/agents/spec.feature_planner.md": "PLANNER-CONTEXT",
      ".claude/commands/spec.implement.md": "IMPLEMENT-CONTEXT",
      ".claude/commands/spec.plan_feature.md": "PLAN-FEATURE-CONTEXT",
      ".github/agents/spec.plan_critic.agent.md": "CRITIC-CONTEXT",
    };
    for (const [file, marker] of Object.entries(legacy)) {
      await fs.outputFile(path.join(root, file), legacyFile(marker));
    }
    await fs.outputFile(
      path.join(root, ".claude", "agents", "my-agent.md"),
      "user-owned"
    );

    vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const prompt = vi.spyOn(inquirer, "prompt").mockImplementation((async (
      questions: Array<{
        name: string;
        choices?: Array<{ value?: string; checked?: boolean }>;
      }>
    ) => {
      const [question] = questions;
      if (question.name === "selectedNames") {
        return {
          selectedNames: question
            .choices!.filter((choice) => choice.value && choice.checked)
            .map((choice) => choice.value),
        };
      }
      if (question.name === "removeLegacy") return { removeLegacy: true };
      throw new Error(`Unexpected update prompt: ${question.name}`);
    }) as unknown as typeof inquirer.prompt);

    try {
      process.chdir(root);
      await updateCommand({ ai: ["claude-code", "copilot"], skipHooks: true });

      const read = (file: string) => fs.readFile(path.join(root, file), "utf8");
      expect(await read(".claude/agents/spec-feature-planner.md")).toContain(
        "PLANNER-CONTEXT"
      );
      expect(await read(".claude/skills/spec-implement/SKILL.md")).toContain(
        "IMPLEMENT-CONTEXT"
      );
      expect(await read(".claude/commands/spec-plan-feature.md")).toContain(
        "PLAN-FEATURE-CONTEXT"
      );
      expect(await read(".github/agents/spec-plan-critic.agent.md")).toContain(
        "CRITIC-CONTEXT"
      );

      for (const file of Object.keys(legacy)) {
        expect(await fs.pathExists(path.join(root, file)), file).toBe(false);
      }
      expect(await read(".claude/agents/my-agent.md")).toBe("user-owned");
      expect(
        prompt.mock.calls.some(([questions]) =>
          (questions as Array<{ name: string }>).some(
            (question) => question.name === "removeLegacy"
          )
        )
      ).toBe(true);
    } finally {
      process.chdir(originalCwd);
      await fs.remove(root);
    }
  }, 60_000);
});
