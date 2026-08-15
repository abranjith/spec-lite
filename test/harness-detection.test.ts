import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeProvider } from "../src/providers/claude-code.js";
import { CopilotProvider } from "../src/providers/copilot.js";
import { CodexProvider } from "../src/providers/codex.js";
import { GenericProvider } from "../src/providers/generic.js";
import { PiProvider } from "../src/providers/pi.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-detection-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe("harness detection", () => {
  it("detects Claude and Copilot project markers as strong signals", async () => {
    const root = await fixture();
    await fs.ensureDir(path.join(root, ".claude"));
    await fs.outputFile(path.join(root, ".github", "copilot-instructions.md"), "# Instructions\n");

    const claude = await new ClaudeCodeProvider().detectHarnessUsage(root);
    const copilot = await new CopilotProvider().detectHarnessUsage(root);

    expect(claude.signals).toContainEqual({ scope: "project", strength: "strong", marker: ".claude" });
    expect(copilot.signals).toContainEqual({
      scope: "project",
      strength: "strong",
      marker: path.join(".github", "copilot-instructions.md"),
    });
  });

  it("treats AGENTS.md as a weak Codex signal and .pi as a strong Pi signal", async () => {
    const root = await fixture();
    await fs.outputFile(path.join(root, "AGENTS.md"), "# Shared instructions\n");
    await fs.ensureDir(path.join(root, ".pi"));

    const codex = await new CodexProvider().detectHarnessUsage(root);
    const pi = await new PiProvider().detectHarnessUsage(root);

    expect(codex.signals).toContainEqual({ scope: "project", strength: "weak", marker: "AGENTS.md" });
    expect(pi.signals).toContainEqual({ scope: "project", strength: "strong", marker: ".pi" });
  });

  it("never auto-detects the generic provider", async () => {
    const root = await fixture();
    expect(await new GenericProvider().detectHarnessUsage(root)).toEqual({ detected: false, signals: [] });
  });
});
