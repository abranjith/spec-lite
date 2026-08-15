import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import inquirer from "inquirer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCommand } from "../src/commands/update.js";
import { loadAllSources } from "../src/utils/prompts.js";

describe("legacy workspace update", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs every current source by default and migrates the config to v2", async () => {
    const originalCwd = process.cwd();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-update-"));
    const allSourceNames = (await loadAllSources()).map((source) => source.name).sort();

    await fs.writeJson(
      path.join(root, ".spec-lite.json"),
      {
        version: "0.1.0",
        format: "v1",
        provider: "copilot",
        installedPrompts: ["plan"],
        installedAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      { spaces: 2 },
    );

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(inquirer, "prompt").mockImplementation(async (questions: any) => {
      const questionList = Array.isArray(questions) ? questions : [questions];
      if (questionList.some((question) => question.name === "directory")) {
        return {
          directory: "project-docs",
          level: "full",
          updateWithDevelopment: true,
        } as any;
      }

      const sourceQuestion = questionList.find(
        (question) => question.name === "selectedNames",
      );
      if (sourceQuestion) {
        return {
          selectedNames: sourceQuestion.choices
            .filter((choice: any) => choice.value && choice.checked)
            .map((choice: any) => choice.value),
        } as any;
      }

      throw new Error("Unexpected update prompt");
    });

    try {
      process.chdir(root);
      await updateCommand({ ai: ["copilot", "generic"], force: true });

      expect(
        await fs.pathExists(
          path.join(root, ".github", "agents", "spec.architect.agent.md"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(root, ".github", "skills", "spec-document", "SKILL.md"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(root, ".github", "prompts", "spec.plan.prompt.md"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(root, ".github", "prompts", "spec.help.prompt.md"),
        ),
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(root, ".spec-lite", "prompts", "spec.document.md"),
        ),
      ).toBe(true);

      const config = await fs.readJson(path.join(root, ".spec-lite.json"));
      expect(config).toMatchObject({
        version: "0.2.0",
        format: "v2",
        provider: "copilot",
        providers: ["copilot", "generic"],
        documentation: {
          directory: "project-docs",
          level: "full",
          updateWithDevelopment: true,
        },
      });
      expect([...config.installedPrompts].sort()).toEqual(allSourceNames);
    } finally {
      process.chdir(originalCwd);
      await fs.remove(root);
    }
  }, 60_000);
});
