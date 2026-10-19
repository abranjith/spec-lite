import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "../src/commands/init.js";
import { getProvider } from "../src/providers/index.js";
import {
  buildCombinedExport,
  resolveExportSources,
} from "../src/commands/export.js";
import { loadAllSources } from "../src/utils/prompts.js";

let temporary: string;
let originalDirectory: string;

beforeEach(async () => {
  originalDirectory = process.cwd();
  temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "spec-lite-portable-control-")
  );
  vi.spyOn(os, "homedir").mockReturnValue(path.join(temporary, "home"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  process.chdir(originalDirectory);
  vi.restoreAllMocks();
  await fs.remove(temporary);
});

describe("installed portable control instructions", () => {
  it.each(["generic", "codex", "claude-code", "copilot", "pi"])(
    "%s keeps scope, acknowledgment and pause behavior in installed roles",
    async (alias) => {
      const target = path.join(temporary, "project");
      await fs.ensureDir(target);
      process.chdir(target);
      await initCommand({ ai: alias, skipProfile: true, force: true });
      const provider = getProvider(alias)!;
      const planPaths = provider.getOutputPaths("plan");
      const yoloPaths = provider.getOutputPaths("yolo");
      const criticPaths = provider.getOutputPaths("plan_critic");
      const criticPath = provider.supportsNativeSkills
        ? path.join(provider.getSkillOutputDir!("plan-critic"), "SKILL.md")
        : (criticPaths.agent ?? criticPaths.prompt);
      const read = (file: string) =>
        fs.readFile(path.join(target, file), "utf8");
      const [plan, critic, yolo] = await Promise.all([
        read(planPaths.agent ?? planPaths.prompt),
        read(criticPath),
        read(yoloPaths.agent ?? yoloPaths.prompt),
      ]);
      for (const role of [plan, critic, yolo]) {
        expect(role).toContain("--tracked");
        expect(role).toContain("--execution");
        expect(role).toContain("--parent");
        expect(role).toContain("never consumes delivery");
        expect(role).toContain("Never answer for the user");
        expect(role).toContain("if native subagents are unavailable");
        expect(role).not.toMatch(/--wait 4m|cache lifetime is five minutes/);
      }
      expect(plan).toContain("--payload plan=");
      expect(critic).toContain("plan-critic.pre --tracked");
      expect(critic).toContain("verdictCode");
      expect(yolo).toContain("run `spec-lite next` before reading");
    },
    60_000
  );

  it("gives Plan Mode delegates their parent execution and own child scope (REV-007)", async () => {
    const source = (file: string) =>
      fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const [feature, implement] = await Promise.all([
      source("skills/feature/SKILL.md"),
      source("skills/implement/SKILL.md"),
    ]);
    expect(feature).toContain(
      "feature.pre --tracked --parent <your-execution-id> --feature FEAT-<ID>"
    );
    expect(implement).toContain(
      "--tracked --parent <your-execution-id> --feature FEAT-<ID>"
    );
    for (const role of [feature, implement])
      expect(role).toContain("(never yours) on every later event");
  });

  it("exports the same ownership and recovery contract for unsupported hosts", async () => {
    const sources = await loadAllSources();
    const selected = resolveExportSources(
      sources,
      ["orchestrator", "plan", "plan-critic", "yolo"],
      false
    );
    const output = await buildCombinedExport(
      selected,
      sources,
      undefined,
      "2026-10-14"
    );
    expect(output).toContain("## Hook Protocol");
    expect(output).toContain(
      "A GitHub reply does not restart a closed agent session"
    );
    expect(output).toContain("--tracked");
    expect(output).toContain("--parent");
    expect(output).toContain("not higher-priority authority");
    expect(output).toContain("decision cancel/reissue");
    expect(output).not.toMatch(/\]\((?!#|[a-z]+:)[^)]+\.md(?:#[^)]+)?\)/i);
  });
});
