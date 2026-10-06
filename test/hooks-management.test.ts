import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { registerHookCommand } from "../src/commands/hook.js";
import { loadRegistry, setHookEnabled } from "../src/hooks/registry.js";
import { runEvent } from "../src/hooks/runner.js";
import { BUILTIN_HOOKS } from "../src/hooks/builtins/index.js";
import type { HookDefinition } from "../src/hooks/types.js";

let temp: string;
let root: string;
let home: string;

const custom: HookDefinition = {
  name: "optional-review",
  events: ["implement.post"],
  type: "prompt",
  prompt: "Review the implementation.",
  description: "Optional review",
  enabled: false,
  order: 50,
  onFailure: "warn",
};

async function writeHooks(directory: string, hooks: HookDefinition[]): Promise<void> {
  await fs.outputJson(path.join(directory, ".spec-lite", "hooks.json"), { version: 1, hooks }, { spaces: 2 });
}

async function cli(...args: string[]): Promise<void> {
  const program = new Command();
  registerHookCommand(program);
  await program.parseAsync(["hook", ...args], { from: "user" });
}

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-management-"));
  root = path.join(temp, "project");
  home = path.join(temp, "home");
  await fs.ensureDir(root);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await fs.remove(temp);
});

describe("hook enable/disable", () => {
  it("creates a complete builtin override and restores it without losing defaults", async () => {
    const builtin = BUILTIN_HOOKS.find((hook) => hook.name === "capture-baseline")!;
    const file = await setHookEnabled(root, builtin.name, false);
    expect((await fs.readJson(file)).hooks).toEqual([{ ...builtin, enabled: false }]);
    expect((await loadRegistry(root)).hooks.some((hook) => hook.name === builtin.name)).toBe(false);
    await setHookEnabled(root, builtin.name, true);
    expect((await fs.readJson(file)).hooks).toEqual([{ ...builtin, enabled: true }]);
  });

  it("keeps disabled hooks inspectable while excluding them from dispatch", async () => {
    await writeHooks(root, [custom]);
    expect((await loadRegistry(root)).hooks.some((hook) => hook.name === custom.name)).toBe(false);
    expect((await loadRegistry(root, { includeDisabled: true })).hooks).toContainEqual({ ...custom, source: "project" });
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(0);
    expect(report.results.some((result) => result.name === custom.name)).toBe(false);
  });

  it("enables a disabled hook and emits it only after opt-in", async () => {
    await writeHooks(root, [custom]);
    await setHookEnabled(root, custom.name, true);
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.results.find((result) => result.name === custom.name)?.status).toBe("emitted");
  });

  it("preserves custom settings, unrelated entries, and declaration order on repeated toggles", async () => {
    const other = { ...custom, name: "other" };
    await writeHooks(root, [other, custom]);
    for (const enabled of [true, false, false, true]) await setHookEnabled(root, custom.name, enabled);
    expect((await fs.readJson(path.join(root, ".spec-lite", "hooks.json"))).hooks).toEqual([
      other, { ...custom, enabled: true },
    ]);
  });

  it("copies a global definition into a project override without changing the global registry", async () => {
    await writeHooks(home, [custom]);
    await setHookEnabled(root, custom.name, true);
    expect((await fs.readJson(path.join(home, ".spec-lite", "hooks.json"))).hooks).toEqual([custom]);
    expect((await loadRegistry(root)).hooks.find((hook) => hook.name === custom.name)?.source).toBe("project");
  });

  it("global changes use global definitions and project overrides still win", async () => {
    await writeHooks(home, [custom]);
    const projectHook = { ...custom, prompt: "Project review." };
    await writeHooks(root, [projectHook]);
    await setHookEnabled(root, custom.name, true, "global");
    expect((await fs.readJson(path.join(home, ".spec-lite", "hooks.json"))).hooks).toEqual([{ ...custom, enabled: true }]);
    expect((await loadRegistry(root)).hooks.some((hook) => hook.name === custom.name)).toBe(false);
  });

  it("rejects unknown names without creating a registry", async () => {
    await expect(setHookEnabled(root, "missing", true)).rejects.toThrow("No hook named");
    expect(await fs.pathExists(path.join(root, ".spec-lite", "hooks.json"))).toBe(false);
  });

  it.each(["{broken", '{"version":1,"hooks":[],"unexpected":true}'])(
    "leaves malformed registries untouched: %s", async (content) => {
      const file = path.join(root, ".spec-lite", "hooks.json");
      await fs.outputFile(file, content);
      await expect(setHookEnabled(root, "capture-baseline", false)).rejects.toThrow();
      expect(await fs.readFile(file, "utf8")).toBe(content);
    }
  );

  it("validates a disabled hook before enabling but permits disabling an invalid active hook", async () => {
    const invalid = { ...custom, events: ["unknown.event"] };
    await writeHooks(root, [invalid]);
    await expect(setHookEnabled(root, invalid.name, true)).rejects.toThrow("matches no known event");
    expect((await fs.readJson(path.join(root, ".spec-lite", "hooks.json"))).hooks).toEqual([invalid]);
    await writeHooks(root, [{ ...invalid, enabled: true }]);
    await setHookEnabled(root, invalid.name, false);
    expect((await loadRegistry(root)).issues).toEqual([]);
  });

  it("collapses duplicate names using the effective definition", async () => {
    await writeHooks(root, [{ ...custom, prompt: "Old" }, custom]);
    await setHookEnabled(root, custom.name, true);
    expect((await fs.readJson(path.join(root, ".spec-lite", "hooks.json"))).hooks).toEqual([{ ...custom, enabled: true }]);
  });

  it("does not override the repository kill switch", async () => {
    await writeHooks(root, [custom]);
    await fs.writeJson(path.join(root, ".spec-lite.json"), { hooks: { enabled: false } });
    await setHookEnabled(root, custom.name, true);
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.disabled).toBe(true);
    expect(report.results).toEqual([]);
  });
});

describe("hook management CLI", () => {
  it("wires --skip into dispatch without changing the hook's enabled state", async () => {
    await writeHooks(root, [{ ...custom, enabled: true }]);
    await cli("run", "implement.post", "--skip", custom.name, "--json");
    const report = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(report.results.find((result: { name: string }) => result.name === custom.name)?.status).toBe("skipped");
    expect((await loadRegistry(root)).hooks.some((hook) => hook.name === custom.name)).toBe(true);
  });
  it("lists disabled hooks with --all and honors the event filter", async () => {
    await writeHooks(root, [custom]);
    await cli("list");
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).not.toContain(custom.name);
    vi.mocked(console.log).mockClear();
    await cli("list", "--all", "--event", "implement.post");
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain(custom.name);
    expect(output).toContain("disabled");
    expect(output).not.toContain("capture-baseline");
  });

  it("registers both state commands and reports unknown names with exit 2", async () => {
    await writeHooks(root, [custom]);
    await cli("enable", custom.name);
    expect((await loadRegistry(root)).hooks.some((hook) => hook.name === custom.name)).toBe(true);
    await cli("disable", custom.name);
    expect((await loadRegistry(root)).hooks.some((hook) => hook.name === custom.name)).toBe(false);
    await cli("enable", "missing");
    expect(process.exitCode).toBe(2);
  });

  it("supports --global without writing a project registry", async () => {
    await cli("disable", "capture-baseline", "--global");
    expect(await fs.pathExists(path.join(root, ".spec-lite", "hooks.json"))).toBe(false);
    expect((await fs.readJson(path.join(home, ".spec-lite", "hooks.json"))).hooks[0].enabled).toBe(false);
  });
});
