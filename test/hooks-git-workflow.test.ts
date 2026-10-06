import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { runEvent } from "../src/hooks/runner.js";
import { BUILTIN_HOOKS } from "../src/hooks/builtins/index.js";
import { git, workflowSlug, GIT_WORKFLOW_HOOKS } from "../src/hooks/builtins/git-workflow.js";
import * as workflow from "../src/hooks/builtins/git-workflow.js";
import { loadRegistry } from "../src/hooks/registry.js";
import type { HookDefinition } from "../src/hooks/types.js";

let temp: string;
let root: string;
let remote: string;
const featureDir = ".spec-lite/features/FEAT-020-execute_operations";

async function configure(hooks: HookDefinition[]): Promise<void> {
  await fs.outputJson(path.join(root, ".spec-lite", "hooks.json"), { version: 1, hooks }, { spaces: 2 });
}

function enabled(name: string, overrides: Partial<HookDefinition> = {}): HookDefinition {
  return { ...BUILTIN_HOOKS.find((hook) => hook.name === name)!, enabled: true, ...overrides };
}

async function prepare(extra?: Record<string, string>) {
  return runEvent({ root, event: "implement.pre", featureId: "FEAT-020", extra });
}

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-git-workflow-"));
  root = path.join(temp, "repo");
  remote = path.join(temp, "remote.git");
  await fs.ensureDir(root);
  vi.spyOn(os, "homedir").mockReturnValue(path.join(temp, "home"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@local.invalid"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await fs.writeFile(path.join(root, "code.txt"), "base\n");
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["init", "--bare", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "origin", "main"]);
  await fs.outputFile(path.join(root, featureDir, "spec.md"), "# Execute operations\n");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.remove(temp);
});

describe("prepare-worktree", () => {
  it("ships all three new hooks disabled", async () => {
    const registry = await loadRegistry(root, { includeDisabled: true });
    for (const name of GIT_WORKFLOW_HOOKS) expect(registry.hooks.find((hook) => hook.name === name)?.enabled).toBe(false);
    expect((await loadRegistry(root)).hooks.map((hook) => hook.name)).toEqual(["capture-baseline", "capture-changeset"]);
  });

  it("creates the named feature branch, carries specs/config, and captures the baseline in the new tree", async () => {
    await configure([enabled("prepare-worktree")]);
    await fs.writeFile(path.join(root, "code.txt"), "parent dirt\n");
    const report = await prepare();
    expect(report.exitCode).toBe(0);
    const tree = report.payload.worktree!;
    expect(tree.path).toBe(path.join(root, ".worktrees", "feat-020-execute-operations"));
    expect(tree.branch).toBe("ft/feat-020-execute-operations");
    expect(tree.fromBranch).toBe("main");
    expect(report.payload.cwd).toBe(tree.path);
    expect(await fs.readFile(path.join(tree.path, "code.txt"), "utf8")).toBe("base\n");
    expect(await fs.pathExists(path.join(tree.path, featureDir, "spec.md"))).toBe(true);
    expect(await fs.pathExists(path.join(tree.path, ".spec-lite", "hooks.json"))).toBe(true);
    expect((await fs.readJson(path.join(tree.path, featureDir, "changeset.json"))).baseline.sha).toBe(await git(root, ["rev-parse", "main"]));
    expect(await fs.pathExists(path.join(root, featureDir, "changeset.json"))).toBe(false);
    expect(await git(root, ["check-ignore", ".worktrees/test/file"])).toContain(".worktrees/test/file");
  });

  it("resumes without overwriting work or adding ignore entries, including after the starting branch changes", async () => {
    await configure([enabled("prepare-worktree")]);
    const first = await prepare();
    const tree = first.payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "work in progress\n");
    await git(root, ["switch", "-c", "other"]);
    const second = await prepare();
    expect(second.exitCode).toBe(0);
    expect(second.payload.worktree?.path).toBe(tree.path);
    expect(second.payload.worktree?.fromBranch).toBe("main");
    expect(await fs.readFile(path.join(tree.path, "code.txt"), "utf8")).toBe("work in progress\n");
    const ignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    expect(ignore.split("/.worktrees/")).toHaveLength(2);
    const nested = await runEvent({ root: tree.path, event: "fix.pre", featureId: "FEAT-020" });
    expect(nested.exitCode).toBe(0);
    expect(nested.payload.worktree?.path).toBe(tree.path);
    expect(await fs.pathExists(path.join(tree.path, ".worktrees"))).toBe(false);
  });

  it("honors options.fromBranch and creates a missing .gitignore", async () => {
    await git(root, ["branch", "develop"]);
    await fs.remove(path.join(root, ".gitignore"));
    await configure([enabled("prepare-worktree", { options: { fromBranch: "develop" } })]);
    const report = await prepare();
    expect(report.exitCode).toBe(0);
    expect(report.payload.worktree?.fromBranch).toBe("develop");
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe("/.worktrees/\n");
  });

  it("uses a fix branch for an ad-hoc named issue and requires a name otherwise", async () => {
    await configure([enabled("prepare-worktree")]);
    const missing = await runEvent({ root, event: "fix.pre" });
    expect(missing.exitCode).toBe(1);
    const named = await runEvent({ root, event: "fix.pre", extra: { name: "Auth ISSUE!" } });
    expect(named.exitCode).toBe(0);
    expect(named.payload.worktree?.branch).toBe("fix/auth-issue");
    expect(path.basename(named.payload.worktree!.path)).toBe("fix-auth-issue");
  });

  it("repairs interrupted setup without resetting the branch", async () => {
    await configure([enabled("prepare-worktree")]);
    const tree = (await prepare()).payload.worktree!;
    const common = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const file = path.join(common, "spec-lite", "worktrees", `${path.basename(tree.path)}.json`);
    const state = await fs.readJson(file);
    state.ready = false;
    await fs.writeJson(file, state);
    await fs.remove(path.join(tree.path, ".spec-lite"));
    const resumed = await prepare();
    expect(resumed.exitCode).toBe(0);
    expect(await fs.pathExists(path.join(tree.path, featureDir, "spec.md"))).toBe(true);
    expect((await fs.readJson(file)).ready).toBe(true);
  });

  it("refuses occupied paths and unrelated existing branches", async () => {
    await configure([enabled("prepare-worktree")]);
    await fs.outputFile(path.join(root, ".worktrees", "feat-020-execute-operations", "keep.txt"), "keep");
    expect((await prepare()).exitCode).toBe(1);
    expect(await fs.readFile(path.join(root, ".worktrees", "feat-020-execute-operations", "keep.txt"), "utf8")).toBe("keep");
    await fs.remove(path.join(root, ".worktrees", "feat-020-execute-operations"));
    await git(root, ["branch", "ft/feat-020-execute-operations"]);
    expect((await prepare()).exitCode).toBe(1);
  });

  it("keeps slugs short and distinct after truncation", () => {
    const slug = workflowSlug(`FEAT-020-${"a".repeat(100)}!`);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).not.toBe(workflowSlug(`FEAT-020-${"a".repeat(100)}b`));
    expect(() => workflowSlug("!!!")).toThrow();
  });
});

describe("commit-progress", () => {
  it("commits each task once, preserves parent dirt, then pushes on completion without another empty commit", async () => {
    await configure([enabled("prepare-worktree"), enabled("commit-progress")]);
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(root, "code.txt"), "parent dirt\n");
    await fs.writeFile(path.join(tree.path, "code.txt"), "task one\n");
    const task = { root: tree.path, event: "implement.task.post", featureId: "FEAT-020", taskId: "TASK-001", extra: { summary: "Changed code" } };
    expect((await runEvent(task)).exitCode).toBe(0);
    const first = await git(tree.path, ["rev-parse", "HEAD"]);
    expect((await runEvent(task)).exitCode).toBe(0);
    expect(await git(tree.path, ["rev-parse", "HEAD"])).toBe(first);
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).toBe("");
    expect(await fs.readFile(path.join(root, "code.txt"), "utf8")).toBe("parent dirt\n");
    const final = { root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Finished feature" } };
    expect((await runEvent(final)).exitCode).toBe(0);
    expect(await git(tree.path, ["rev-parse", "HEAD"])).toBe(first);
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).toContain(first);
    expect((await runEvent(final)).exitCode).toBe(0);
    expect(await git(tree.path, ["rev-parse", "HEAD"])).toBe(first);
    expect(await git(tree.path, ["show", "--format=", "--name-only", "HEAD"])).not.toContain("changeset.json");
  });

  it("stages deletions and new files, and commits/pushes a completed fix", async () => {
    await configure([enabled("prepare-worktree"), enabled("commit-progress")]);
    const tree = (await runEvent({ root, event: "fix.pre", extra: { name: "auth-issue" } })).payload.worktree!;
    await fs.remove(path.join(tree.path, "code.txt"));
    await fs.writeFile(path.join(tree.path, "new.txt"), "replacement\n");
    const report = await runEvent({ root: tree.path, event: "fix.post", extra: { summary: "Fix auth issue" } });
    expect(report.exitCode).toBe(0);
    expect(await git(tree.path, ["show", "--format=", "--name-status", "HEAD"])).toContain("D\tcode.txt");
    expect(await git(tree.path, ["show", "--format=", "--name-status", "HEAD"])).toContain("A\tnew.txt");
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).not.toBe("");
  });

  it("refuses to commit in the parent checkout", async () => {
    await configure([enabled("commit-progress")]);
    const head = await git(root, ["rev-parse", "HEAD"]);
    const report = await runEvent({ root, event: "fix.post", extra: { summary: "Done" } });
    expect(report.exitCode).toBe(1);
    expect(await git(root, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("stops the chain after a failed push", async () => {
    await configure([enabled("prepare-worktree"), enabled("commit-progress", { options: { remote: "missing" } }), {
      name: "after-push", events: ["implement.post"], type: "prompt", prompt: "Should not run", order: 300,
    }]);
    const tree = (await prepare()).payload.worktree!;
    const report = await runEvent({ root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Done" } });
    expect(report.exitCode).toBe(1);
    expect(report.results.some((result) => result.name === "after-push")).toBe(false);
  });
});

describe("temporary hook suppression", () => {
  it.each(["skip", "env", "yolo"])("suppresses Git workflows through %s without editing the registry", async (mode) => {
    await configure(GIT_WORKFLOW_HOOKS.map((name) => enabled(name)));
    const file = path.join(root, ".spec-lite", "hooks.json");
    const before = await fs.readFile(file, "utf8");
    if (mode === "env") vi.stubEnv("SPEC_LITE_SKIP_HOOKS", GIT_WORKFLOW_HOOKS.join(","));
    const report = await runEvent({ root, event: "implement.pre", featureId: "FEAT-020",
      skip: mode === "skip" ? [...GIT_WORKFLOW_HOOKS] : undefined,
      extra: mode === "yolo" ? { mode: "yolo" } : undefined,
    });
    expect(report.exitCode).toBe(0);
    expect(report.results.find((result) => result.name === "prepare-worktree")?.status).toBe("skipped");
    expect(report.results.find((result) => result.name === "capture-baseline")?.status).toBe("ok");
    expect(await fs.pathExists(path.join(root, ".worktrees"))).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe(before);
    const completion = await runEvent({ root, event: "implement.post", featureId: "FEAT-020", skip: mode === "skip" ? [...GIT_WORKFLOW_HOOKS] : undefined, extra: mode === "yolo" ? { mode: "yolo", summary: "Done" } : { summary: "Done" } });
    expect(completion.exitCode).toBe(0);
    expect(completion.results.find((result) => result.name === "create-pull-request")?.status).toBe("skipped");
  });
});

describe("create-pull-request", () => {
  async function customAdapter(createOperation = "create") {
    const script = path.join(temp, "adapter.cjs");
    const marker = path.join(temp, "prs.json");
    await fs.writeFile(script, `
const fs = require('node:fs');
const [operation, marker] = process.argv.slice(2);
const existing = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null;
if (operation === 'lookup-failed') { process.stderr.write('Lookup failed'); process.exit(1); }
if (operation === 'lookup') { process.stdout.write(JSON.stringify(existing && {url: existing.url})); }
else {
  const result = {url: 'https://forge.example/pr/123', creates: (existing?.creates ?? 0) + 1,
    head: process.env.SPEC_LITE_PR_HEAD, base: process.env.SPEC_LITE_PR_BASE,
    title: process.env.SPEC_LITE_PR_TITLE, body: fs.readFileSync(process.env.SPEC_LITE_PR_BODY_FILE, 'utf8'),
    depth: process.env.SPEC_LITE_HOOK_DEPTH, skip: process.env.SPEC_LITE_SKIP_HOOKS};
  fs.writeFileSync(marker, JSON.stringify(result));
  if (operation === 'lost-response') { process.exit(1); }
  process.stdout.write(JSON.stringify({url: result.url}));
}
`);
    const options = { provider: "command" as const, targetBranch: "main", command: [process.execPath, script, createOperation, marker], lookupCommand: [process.execPath, script, "lookup", marker] };
    return { options, marker };
  }

  it("requires an explicit target/provider and fails before creating a worktree", async () => {
    await configure([enabled("prepare-worktree"), enabled("create-pull-request")]);
    const report = await prepare();
    expect(report.exitCode).toBe(2);
    expect(report.registryIssues.join("\n")).toContain("options.targetBranch");
    expect(await fs.pathExists(path.join(root, ".worktrees"))).toBe(false);
    const adapter = await customAdapter();
    await configure([enabled("create-pull-request", { options: { ...adapter.options, lookupCommand: undefined } })]);
    expect((await loadRegistry(root)).issues.some((issue) => issue.message.includes("lookupCommand"))).toBe(true);
  });

  it("creates once using a custom provider, includes the summary, and returns cleanup guidance on retries", async () => {
    const { options, marker } = await customAdapter();
    await configure([enabled("prepare-worktree"), enabled("commit-progress"), enabled("create-pull-request", { options })]);
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "finished\n");
    const final = { root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Execute operations" }, skip: ["inactive-hook"] };
    const first = await runEvent(final);
    expect(first.exitCode).toBe(0);
    const data = await fs.readJson(marker);
    expect(data.creates).toBe(1);
    expect(data.head).toBe(tree.branch);
    expect(data.base).toBe("main");
    expect(data.title).toBe("FEAT-020: Execute operations");
    expect(data.body).toContain("Execute operations");
    expect(data.depth).toBe("1");
    expect(data.skip).toBe("inactive-hook");
    expect(first.results.at(-1)?.message).toContain("worktree remove");
    expect(first.results.at(-1)?.message).toContain("After merging");
    const second = await runEvent(final);
    expect(second.exitCode).toBe(0);
    expect(second.results.at(-1)?.message).toContain("Existing pull request");
    expect((await fs.readJson(marker)).creates).toBe(1);
  });

  it("recovers a lost creation response by querying again instead of creating twice", async () => {
    const { options, marker } = await customAdapter("lost-response");
    await configure([enabled("prepare-worktree"), enabled("commit-progress"), enabled("create-pull-request", { options })]);
    const tree = (await prepare()).payload.worktree!;
    const final = { root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Done" } };
    expect((await runEvent(final)).exitCode).toBe(0);
    expect((await runEvent(final)).exitCode).toBe(0);
    expect((await fs.readJson(marker)).creates).toBe(1);
  });

  it("does not create when lookup fails or the branch has not been pushed", async () => {
    const { options, marker } = await customAdapter();
    await configure([enabled("prepare-worktree"), enabled("create-pull-request", { options })]);
    const tree = (await prepare()).payload.worktree!;
    const final = { root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Done" } };
    expect((await runEvent(final)).exitCode).toBe(1);
    expect(await fs.pathExists(marker)).toBe(false);
    await git(tree.path, ["push", "origin", `HEAD:refs/heads/${tree.branch}`]);
    const failedOptions = { ...options, lookupCommand: [...options.lookupCommand] };
    failedOptions.lookupCommand[2] = "lookup-failed";
    await fs.writeJson(path.join(tree.path, ".spec-lite", "hooks.json"), { version: 1, hooks: [enabled("create-pull-request", { options: failedOptions })] });
    expect((await runEvent(final)).exitCode).toBe(1);
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it.each(["github", "azure-devops"] as const)("queries and creates through the %s adapter, then reuses its PR", async (provider) => {
    await configure([enabled("prepare-worktree"), enabled("commit-progress"), enabled("create-pull-request", { options: { provider, targetBranch: "main" } })]);
    const tree = (await prepare()).payload.worktree!;
    const realGit = workflow.git;
    vi.spyOn(workflow, "git").mockImplementation((directory, args, timeout) => {
      if (args[0] === "remote" && args[1] === "get-url") return Promise.resolve(provider === "github" ? "https://github.com/team/repo.git" : "https://dev.azure.com/team/project/_git/repo");
      return realGit(directory, args, timeout);
    });
    let created = false;
    const program = vi.spyOn(workflow, "runProgram").mockImplementation(async (_directory, bin, args) => {
      expect(bin).toBe(provider === "github" ? "gh" : "az");
      if (args.includes("list")) return JSON.stringify(created ? [provider === "github" ? { url: "https://github.com/team/repo/pull/1" } : { pullRequestId: 1 }] : []);
      expect(args).toContain(provider === "github" ? "--base" : "--target-branch");
      expect(args).toContain("main");
      expect(args).toContain(tree.branch);
      created = true;
      return provider === "github" ? "https://github.com/team/repo/pull/1" : JSON.stringify({ pullRequestId: 1 });
    });
    const final = { root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Done" } };
    expect((await runEvent(final)).exitCode).toBe(0);
    expect((await runEvent(final)).exitCode).toBe(0);
    expect(program.mock.calls.filter((call) => call[2].includes("create"))).toHaveLength(1);
  });

  it("skips PR creation if the pushed branch has no difference from its target", async () => {
    const { options, marker } = await customAdapter();
    await configure([enabled("prepare-worktree"), enabled("create-pull-request", { options })]);
    const tree = (await prepare()).payload.worktree!;
    await git(tree.path, ["push", "origin", `HEAD:refs/heads/${tree.branch}`]);
    const report = await runEvent({ root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "No changes" } });
    expect(report.exitCode).toBe(0);
    expect(report.results.at(-1)?.message).toContain("No changes against main");
    expect(await fs.pathExists(marker)).toBe(false);
  });
});
