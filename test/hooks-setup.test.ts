import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { git } from "../src/hooks/builtins/git-workflow.js";
import { loadRegistry } from "../src/hooks/registry.js";
import { offerHookSetup, runHookSetup, undecidedHooks, OPT_IN_HOOKS, type HookPrompter } from "../src/hooks/setup.js";
import { BUILTIN_HOOKS } from "../src/hooks/builtins/index.js";

let temp: string;
let root: string;
const hooksFile = () => path.join(root, ".spec-lite", "hooks.json");
const entries = async () => (await fs.readJson(hooksFile())).hooks;

/** Accept the default the question offers. */
const DEFAULT = Symbol("default");

/** Answers questions by pattern; any question without an answer fails the test. */
function scripted(answers: Array<[RegExp, unknown]>): HookPrompter & { asked: string[] } {
  const asked: string[] = [];
  const answer = (message: string) => {
    asked.push(message);
    const match = answers.find(([pattern]) => pattern.test(message));
    if (!match) throw new Error(`Unexpected question: ${message}`);
    return match[1];
  };
  return {
    asked,
    confirm: async (message, defaultValue) => {
      const value = answer(message);
      return value === DEFAULT ? defaultValue : (value as boolean);
    },
    input: async (message, defaultValue, validate) => {
      const raw = answer(message);
      const value = raw === DEFAULT ? defaultValue ?? "" : (raw as string);
      const valid = validate(value);
      if (valid !== true) throw new Error(`Rejected "${value}" for "${message}": ${valid}`);
      return value;
    },
    select: async (message, _choices, defaultValue) => {
      const value = answer(message);
      return value === DEFAULT ? defaultValue! : (value as string);
    },
  };
}

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-setup-"));
  root = path.join(temp, "repo");
  await fs.ensureDir(root);
  vi.spyOn(os, "homedir").mockReturnValue(path.join(temp, "home"));
  await git(root, ["init", "-b", "develop"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(temp);
});

describe("hook setup", () => {
  it("offers only the hooks that ship turned off", () => {
    expect(OPT_IN_HOOKS).toEqual(["prepare-worktree", "commit-progress", "create-pull-request"]);
  });

  it("enables each hook with its required options as settings-only entries", async () => {
    const prompter = scripted([
      [/^Set up optional hooks/, true],
      [/^Enable prepare-worktree/, true],
      [/^Branch new worktrees start from/, DEFAULT],
      [/^Enable commit-progress/, true],
      [/^Enable create-pull-request/, true],
      [/^Where are pull requests opened/, "github"],
      [/^Branch pull requests merge into/, DEFAULT],
    ]);
    const lines = await offerHookSetup(root, prompter);
    expect(lines).toEqual([
      'Enabled prepare-worktree {"fromBranch":"develop"}',
      "Enabled commit-progress",
      'Enabled create-pull-request {"provider":"github","targetBranch":"develop"}',
    ]);
    expect(await entries()).toEqual([
      { name: "prepare-worktree", enabled: true, options: { fromBranch: "develop" } },
      { name: "commit-progress", enabled: true },
      { name: "create-pull-request", enabled: true, options: { provider: "github", targetBranch: "develop" } },
    ]);
    const { hooks, issues } = await loadRegistry(root);
    expect(issues).toEqual([]);
    // The definition still comes from spec-lite, so it keeps receiving fixes.
    const shipped = BUILTIN_HOOKS.find((hook) => hook.name === "prepare-worktree")!;
    expect(hooks.find((hook) => hook.name === "prepare-worktree")?.events).toEqual(shipped.events);
  });

  it("skips the hooks that need a skipped hook without asking about them", async () => {
    const prompter = scripted([
      [/^Set up optional hooks/, true],
      [/^Enable prepare-worktree/, false],
    ]);
    expect(await offerHookSetup(root, prompter)).toEqual([
      "Skipped prepare-worktree",
      "Skipped commit-progress: it needs prepare-worktree.",
      "Skipped create-pull-request: it needs commit-progress.",
    ]);
    expect(await entries()).toEqual(OPT_IN_HOOKS.map((name) => ({ name, enabled: false })));
  });

  it("records a declined setup, so later updates ask only about hooks added since", async () => {
    await offerHookSetup(root, scripted([[/^Set up optional hooks/, false]]));
    expect(await entries()).toEqual(OPT_IN_HOOKS.map((name) => ({ name, enabled: false })));
    expect(await undecidedHooks(root)).toEqual([]);
    expect(await offerHookSetup(root, scripted([]))).toEqual([]);

    // A hook shipped in a later release has no entry yet; only it is offered.
    await fs.outputJson(hooksFile(), { version: 1, hooks: [
      { name: "prepare-worktree", enabled: true, options: { fromBranch: "develop" } },
      { name: "commit-progress", enabled: true },
    ] });
    const prompter = scripted([
      [/^Set up optional hooks \(create-pull-request\)/, true],
      [/^Enable create-pull-request/, true],
      [/^Where are pull requests opened/, "command"],
      [/^Branch pull requests merge into/, "main"],
      [/^Command that creates a PR/, "node scripts/pr.cjs create"],
      [/^Command that finds existing PRs/, '["node", "scripts/pr.cjs", "lookup"]'],
    ]);
    await offerHookSetup(root, prompter);
    expect((await entries())[2]).toEqual({
      name: "create-pull-request", enabled: true,
      options: { provider: "command", targetBranch: "main", command: ["node", "scripts/pr.cjs", "create"], lookupCommand: ["node", "scripts/pr.cjs", "lookup"] },
    });
    expect((await loadRegistry(root)).issues).toEqual([]);
  });

  it("revisits every decision, keeping custom definitions and settings it doesn't ask about", async () => {
    const custom = { ...BUILTIN_HOOKS.find((hook) => hook.name === "commit-progress")!, enabled: true, timeoutMs: 600000 };
    await fs.outputJson(hooksFile(), { version: 1, hooks: [
      { name: "prepare-worktree", enabled: true, timeoutMs: 900000, options: { fromBranch: "develop", worktreeRoot: "trees" } },
      custom,
    ] });
    const prompter = scripted([
      [/^Enable prepare-worktree/, DEFAULT],
      [/^Branch new worktrees start from/, "origin/main"],
      [/^Enable create-pull-request/, false],
    ]);
    const { lines } = await runHookSetup(root, OPT_IN_HOOKS, prompter);
    expect(lines).toContain(`Kept commit-progress: it has a custom definition in ${hooksFile()}.`);
    expect(await entries()).toEqual([
      { name: "prepare-worktree", enabled: true, timeoutMs: 900000, options: { fromBranch: "origin/main", worktreeRoot: "trees" } },
      custom,
      { name: "create-pull-request", enabled: false },
    ]);
  });

  it("suggests the PR target from the start branch and refuses a branch starting with a hyphen", async () => {
    await fs.outputJson(hooksFile(), { version: 1, hooks: [
      { name: "prepare-worktree", enabled: true, options: { fromBranch: "origin/release" } },
      { name: "commit-progress", enabled: true },
    ] });
    const suggested: string[] = [];
    const prompter = scripted([
      [/^Enable create-pull-request/, true],
      [/^Where are pull requests opened/, "github"],
      [/^Branch pull requests merge into/, "-x"],
    ]);
    const input = prompter.input;
    prompter.input = async (message, defaultValue, validate) => {
      suggested.push(defaultValue ?? "");
      return input(message, defaultValue, validate);
    };
    await expect(runHookSetup(root, ["create-pull-request"], prompter)).rejects.toThrow("Cannot start with a hyphen");
    expect(suggested).toEqual(["release"]);
  });

  it("saves nothing when the result would break the registry", async () => {
    const before = { version: 1, hooks: [{ name: "early", events: ["implement.pre"], type: "prompt", prompt: "First", order: -1 }] };
    await fs.outputJson(hooksFile(), before);
    const prompter = scripted([
      [/^Enable prepare-worktree/, true],
      [/^Branch new worktrees start from/, DEFAULT],
    ]);
    await expect(runHookSetup(root, ["prepare-worktree"], prompter)).rejects.toThrow("must run first on implement.pre");
    expect(await fs.readJson(hooksFile())).toEqual(before);
  });
});
