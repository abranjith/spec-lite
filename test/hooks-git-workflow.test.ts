import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "fs-extra";
import { runEvent } from "../src/hooks/runner.js";
import { BUILTIN_HOOKS } from "../src/hooks/builtins/index.js";
import { git, workflowSlug, GIT_WORKFLOW_HOOKS, localBranchExists, programInvocation } from "../src/hooks/builtins/git-workflow.js";
import * as workflow from "../src/hooks/builtins/git-workflow.js";
import { validateGitWorkflowConfig } from "../src/hooks/builtins/git-config.js";
import { cleanupMerged, cleanupWorkflow, listWorkflows } from "../src/hooks/builtins/worktree-lifecycle.js";
import { loadRegistry, setHooksEnabled } from "../src/hooks/registry.js";
import type { GitWorkflowConfig, HookDefinition, PullRequestConfig } from "../src/hooks/types.js";

// Each scenario drives real Git repositories end to end.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

let temp: string;
let root: string;
let remote: string;
const featureDir = ".spec-lite/features/FEAT-020-execute_operations";
const otherDir = ".spec-lite/features/FEAT-021-report_results";
const featureTree = "feat-020-execute-operations";

async function configure(hooks: HookDefinition[], gitWorkflow: GitWorkflowConfig = { fromBranch: "main" }, at = root): Promise<void> {
  await fs.outputJson(path.join(at, ".spec-lite", "hooks.json"), { version: 1, hooks }, { spaces: 2 });
  await fs.outputJson(path.join(at, ".spec-lite.json"), { gitWorkflow }, { spaces: 2 });
}

function enabled(name: string, overrides: Partial<HookDefinition> = {}): HookDefinition {
  return { ...BUILTIN_HOOKS.find((hook) => hook.name === name)!, enabled: true, ...overrides };
}

const commitChain = () => [enabled("prepare-worktree"), enabled("commit-progress")];
const fullChain = () => [...commitChain(), enabled("create-pull-request")];

async function prepare(extra?: Record<string, string>) {
  return runEvent({ root, event: "implement.pre", featureId: "FEAT-020", extra });
}

async function complete(at: string, summary = "Done", extra: Record<string, string> = {}) {
  return runEvent({ root: at, event: "implement.post", featureId: "FEAT-020", extra: { summary, ...extra } });
}

const ignored = (at: string, file: string) => git(at, ["check-ignore", "-q", file]).then(() => true, () => false);

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
  await git(root, ["init", "--bare", "-b", "main", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "origin", "main"]);
  // Uncommitted, as specs usually are when Implement starts.
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

  it("creates the feature branch, carries its specs, captures the baseline there, and edits no tracked file", async () => {
    await configure([enabled("prepare-worktree")]);
    await fs.writeFile(path.join(root, "code.txt"), "parent dirt\n");
    const report = await prepare();
    expect(report.exitCode).toBe(0);
    const tree = report.payload.worktree!;
    expect(tree.path).toBe(path.join(root, ".worktrees", featureTree));
    expect(tree.branch).toBe(`ft/${featureTree}`);
    expect(tree.identity).toBe("feature:FEAT-020");
    expect(tree.fromBranch).toBe("main");
    expect(report.payload.cwd).toBe(tree.path);
    expect(await fs.readFile(path.join(tree.path, "code.txt"), "utf8")).toBe("base\n");
    expect(await fs.pathExists(path.join(tree.path, featureDir, "spec.md"))).toBe(true);
    expect(await fs.pathExists(path.join(tree.path, ".spec-lite", "hooks.json"))).toBe(true);
    const changeset = await fs.readJson(path.join(tree.path, featureDir, "changeset.json"));
    expect(changeset.baseline.sha).toBe(await git(root, ["rev-parse", "main"]));
    expect(changeset.baseline.workflow).toBe(`${tree.branch}@${tree.initialHead}`);
    expect(await fs.pathExists(path.join(root, featureDir, "changeset.json"))).toBe(false);
    // H4: ignored through .git/info/exclude; .gitignore is untouched in both checkouts.
    expect(await ignored(root, ".worktrees/x/file")).toBe(true);
    expect(await ignored(tree.path, `${featureDir}/hooks.log.jsonl`)).toBe(true);
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe("node_modules/\n");
    expect(await fs.readFile(path.join(tree.path, ".gitignore"), "utf8")).toBe("node_modules/\n");
  });

  it("resumes the same worktree from either checkout and from each task, without overwriting work", async () => {
    await configure([enabled("prepare-worktree")]);
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "work in progress\n");
    await git(root, ["switch", "-c", "other"]);
    const again = await prepare();
    expect(again.exitCode).toBe(0);
    expect(again.payload.worktree).toEqual(tree);
    expect(await fs.readFile(path.join(tree.path, "code.txt"), "utf8")).toBe("work in progress\n");
    // Each task re-announces the worktree, so a missed handoff is caught before edits.
    const task = await runEvent({ root, event: "implement.task.pre", featureId: "FEAT-020", taskId: "TASK-002" });
    expect(task.payload.worktree?.path).toBe(tree.path);
    const inside = await runEvent({ root: tree.path, event: "fix.pre", featureId: "FEAT-020", extra: { name: "edge-case" } });
    expect(inside.exitCode).toBe(0);
    expect(inside.payload.worktree?.path).toBe(tree.path);
    expect(await fs.pathExists(path.join(tree.path, ".worktrees"))).toBe(false);
  });

  it("starts from gitWorkflow.fromBranch, or from the remote's tip with fetch", async () => {
    await git(root, ["branch", "develop"]);
    await configure([enabled("prepare-worktree")], { fromBranch: "develop" });
    const local = await prepare();
    expect(local.payload.worktree?.fromBranch).toBe("develop");
    expect(local.payload.worktree?.initialHead).toBe(await git(root, ["rev-parse", "develop"]));

    const upstream = path.join(temp, "upstream");
    await git(temp, ["clone", "-b", "main", remote, upstream]);
    await git(upstream, ["-c", "user.email=a@b.invalid", "-c", "user.name=A", "commit", "--allow-empty", "-m", "remote only"]);
    await git(upstream, ["push", "origin", "main"]);
    await configure([enabled("prepare-worktree")], { fromBranch: "main", fetch: true });
    const fetched = await runEvent({ root, event: "fix.pre", extra: { name: "fresh" } });
    expect(fetched.exitCode).toBe(0);
    expect(fetched.payload.worktree?.initialHead).toBe(await git(upstream, ["rev-parse", "HEAD"]));
  });

  it("names fixes and reviews from stable identifiers, and resumes a fix with or without --feature", async () => {
    await configure([enabled("prepare-worktree")]);
    expect((await runEvent({ root, event: "fix.pre" })).exitCode).toBe(1);
    const fix = await runEvent({ root, event: "fix.pre", featureId: "FEAT-020", extra: { name: "Auth ISSUE!" } });
    expect(fix.payload.worktree?.branch).toBe("fix/auth-issue");
    expect(path.basename(fix.payload.worktree!.path)).toBe("fix-auth-issue");
    const retry = await runEvent({ root, event: "fix.pre", extra: { name: "auth-issue" } });
    expect(retry.exitCode).toBe(0);
    expect(retry.payload.worktree?.path).toBe(fix.payload.worktree?.path);
    const review = await runEvent({ root, event: "implement.pre", extra: { name: "checkout_hardening" } });
    expect(review.payload.worktree?.branch).toBe("review/checkout-hardening");
  });

  it("reuses a feature's active workflow for its fixes and reviews, and refuses another feature inside it", async () => {
    await configure([enabled("prepare-worktree")]);
    const tree = (await prepare()).payload.worktree!;
    const fix = await runEvent({ root, event: "fix.pre", featureId: "FEAT-020", extra: { name: "regression" } });
    expect(fix.payload.worktree?.path).toBe(tree.path);
    const review = await runEvent({ root, event: "implement.pre", featureId: "FEAT-020", extra: { name: "execute_operations" } });
    expect(review.payload.worktree?.path).toBe(tree.path);
    await fs.outputFile(path.join(tree.path, otherDir, "spec.md"), "# Report results\n");
    const other = await runEvent({ root: tree.path, event: "implement.pre", featureId: "FEAT-021" });
    expect(other.exitCode).toBe(1);
    expect(other.results[0].message).toContain("belongs to feature:FEAT-020");
  });

  it("fails for a feature ID that does not resolve instead of inventing a name", async () => {
    await configure([enabled("prepare-worktree")]);
    const report = await runEvent({ root, event: "implement.pre", featureId: "FEAT-099" });
    expect(report.exitCode).toBe(1);
    expect(report.results[0].message).toContain("FEAT-099 was not found");
    expect(await fs.pathExists(path.join(root, ".worktrees"))).toBe(false);
  });

  it("copies only the work's own inputs", async () => {
    await configure([enabled("prepare-worktree")]);
    await fs.outputFile(path.join(root, ".spec-lite", "features", "FEAT-099-draft", "spec.md"), "# Unrelated draft\n");
    await fs.outputFile(path.join(root, ".spec-lite", "TODO.md"), "- [ ] unrelated\n");
    await fs.outputFile(path.join(root, ".spec-lite", "plan_orders.md"), "| FEAT-020 | Execute operations |\n");
    await fs.outputFile(path.join(root, ".spec-lite", "plan_other.md"), "| FEAT-030 | Other |\n");
    const tree = (await prepare()).payload.worktree!;
    expect(await fs.pathExists(path.join(tree.path, featureDir, "spec.md"))).toBe(true);
    expect(await fs.pathExists(path.join(tree.path, ".spec-lite", "plan_orders.md"))).toBe(true);
    expect(await fs.pathExists(path.join(tree.path, ".spec-lite", "plan_other.md"))).toBe(false);
    expect(await fs.pathExists(path.join(tree.path, ".spec-lite", "features", "FEAT-099-draft"))).toBe(false);
    expect(await fs.pathExists(path.join(tree.path, ".spec-lite", "TODO.md"))).toBe(false);
  });

  it("honors gitWorkflow.worktreeRoot", async () => {
    await configure([enabled("prepare-worktree")], { fromBranch: "main", worktreeRoot: "work/trees" });
    const tree = (await prepare()).payload.worktree!;
    expect(tree.path).toBe(path.join(root, "work", "trees", featureTree));
    expect(await ignored(root, "work/trees/x")).toBe(true);
  });

  it("finishes an interrupted setup without resetting the branch, but never a damaged checkout", async () => {
    await configure([enabled("prepare-worktree")]);
    const tree = (await prepare()).payload.worktree!;
    const common = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const file = path.join(common, "spec-lite", "worktrees", `${featureTree}.json`);
    const state = await fs.readJson(file);
    await fs.writeJson(file, { ...state, ready: false });
    await fs.remove(path.join(tree.path, ".spec-lite"));
    const resumed = await prepare();
    expect(resumed.exitCode).toBe(0);
    expect(await fs.pathExists(path.join(tree.path, featureDir, "spec.md"))).toBe(true);
    expect((await fs.readJson(file)).ready).toBe(true);

    await fs.writeJson(file, { ...state, ready: false });
    await fs.remove(path.join(tree.path, "code.txt"));
    const damaged = await prepare();
    expect(damaged.exitCode).toBe(1);
    expect(damaged.results[0].message).toContain("unexpected changes (code.txt)");
  });

  it("refuses occupied paths and unrelated existing branches", async () => {
    await configure([enabled("prepare-worktree")]);
    await fs.outputFile(path.join(root, ".worktrees", featureTree, "keep.txt"), "keep");
    expect((await prepare()).exitCode).toBe(1);
    expect(await fs.readFile(path.join(root, ".worktrees", featureTree, "keep.txt"), "utf8")).toBe("keep");
    await fs.remove(path.join(root, ".worktrees", featureTree));
    await git(root, ["branch", `ft/${featureTree}`]);
    expect((await prepare()).exitCode).toBe(1);
  });

  it("never resumes a removed workflow's branch or starts from its old base", async () => {
    await configure(commitChain());
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "done\n");
    expect((await complete(tree.path)).exitCode).toBe(0);
    // H3: logs are ignored and changeset.json is committed, so a plain remove works.
    expect(await git(tree.path, ["status", "--porcelain"])).toBe("");
    await git(root, ["worktree", "remove", tree.path]);
    const blocked = await prepare();
    expect(blocked.exitCode).toBe(1);
    expect(blocked.results[0].message).toContain(`spec-lite worktree cleanup ${featureTree}`);
    await git(root, ["branch", "-D", tree.branch]);
    await fs.writeFile(path.join(root, "later.txt"), "later\n");
    await git(root, ["add", "later.txt"]);
    await git(root, ["commit", "-m", "later work"]);
    const fresh = await prepare();
    expect(fresh.exitCode).toBe(0);
    expect(fresh.payload.worktree?.initialHead).toBe(await git(root, ["rev-parse", "main"]));
    expect(await fs.pathExists(path.join(fresh.payload.worktree!.path, "later.txt"))).toBe(true);
  });

  it("takes over a lock left by a process that exited, and waits for a live one", async () => {
    await configure([enabled("prepare-worktree")]);
    const common = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const destination = path.join(root, ".worktrees", featureTree);
    const lock = path.join(path.resolve(common), "spec-lite", "locks", `${crypto.createHash("sha256").update(destination).digest("hex")}.lock`);
    await fs.outputJson(lock, { pid: process.pid, host: os.hostname() });
    const busy = await prepare();
    expect(busy.exitCode).toBe(1);
    expect(busy.results[0].message).toContain(`process ${process.pid}`);
    const exited = spawnSync(process.execPath, ["-e", ""]).pid;
    await fs.outputJson(lock, { pid: exited, host: os.hostname() });
    expect((await prepare()).exitCode).toBe(0);
    expect(await fs.pathExists(lock)).toBe(false);
  });

  it("keeps slugs short and distinct after truncation", () => {
    const slug = workflowSlug(`FEAT-020-${"a".repeat(100)}!`);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).not.toBe(workflowSlug(`FEAT-020-${"a".repeat(100)}b`));
    expect(() => workflowSlug("!!!")).toThrow();
  });
});

describe("plan and YOLO workflows", () => {
  async function writePlan(at = root): Promise<void> {
    await fs.outputFile(path.join(at, otherDir, "spec.md"), "# Report results\n");
    await fs.outputFile(path.join(at, ".spec-lite", "plan_orders.md"), "| ID | Feature |\n|---|---|\n| FEAT-020 | Execute operations |\n| FEAT-021 | Report results |\n");
  }

  it("runs a plan in one workflow: features join it from any checkout and its PR opens at plan completion", async () => {
    await writePlan();
    const { options, marker } = await customAdapter();
    await configure(fullChain(), { fromBranch: "main", pullRequest: options });
    const plan = await runEvent({ root, event: "implement.pre", extra: { plan: ".spec-lite/plan_orders.md" } });
    expect(plan.exitCode).toBe(0);
    const tree = plan.payload.worktree!;
    expect(tree.branch).toBe("plan/orders");
    expect(path.basename(tree.path)).toBe("plan-orders");

    const first = await runEvent({ root, event: "implement.pre", featureId: "FEAT-020" });
    expect(first.payload.worktree?.path).toBe(tree.path);
    await fs.writeFile(path.join(tree.path, "code.txt"), "feature 20\n");
    const done20 = await complete(tree.path, "Execute operations");
    expect(done20.exitCode).toBe(0);
    expect(done20.results.at(-1)?.message).toContain("created when plan:orders completes");
    expect(await fs.pathExists(marker)).toBe(false);

    // The next feature builds on the first: same branch, FEAT-020's code present.
    const second = await runEvent({ root, event: "implement.pre", featureId: "FEAT-021" });
    expect(second.payload.worktree?.path).toBe(tree.path);
    expect(await fs.readFile(path.join(tree.path, "code.txt"), "utf8")).toBe("feature 20\n");
    await fs.writeFile(path.join(tree.path, "report.txt"), "feature 21\n");
    expect((await runEvent({ root: tree.path, event: "implement.post", featureId: "FEAT-021", extra: { summary: "Report results" } })).exitCode).toBe(0);
    expect((await fs.readJson(path.join(tree.path, otherDir, "changeset.json"))).files.map((file: { path: string }) => file.path)).toEqual(["report.txt"]);

    const final = await runEvent({ root: tree.path, event: "implement.post", extra: { plan: ".spec-lite/plan_orders.md", summary: "Orders plan" } });
    expect(final.exitCode).toBe(0);
    expect((await fs.readJson(marker)).title).toBe("plan_orders.md: Orders plan");
  });

  it("keeps a YOLO run in one workflow; features listed by plans written inside it join it", async () => {
    await configure([enabled("prepare-worktree")]);
    const run = await runEvent({ root, event: "implement.pre", extra: { yolo: "yolo-20261006-store" } });
    const tree = run.payload.worktree!;
    expect(tree.branch).toBe("yolo/20261006-store");
    await writePlan(tree.path);
    const feature = await runEvent({ root, event: "implement.pre", featureId: "FEAT-020" });
    expect(feature.payload.worktree?.path).toBe(tree.path);
    const otherPlan = await runEvent({ root: tree.path, event: "implement.pre", extra: { plan: ".spec-lite/plan_orders.md" } });
    expect(otherPlan.exitCode).toBe(1);
    expect(otherPlan.results[0].message).toContain("belongs to yolo:20261006-store");
  });

  it("gives a feature implemented on its own its own workflow", async () => {
    await writePlan();
    await configure([enabled("prepare-worktree")]);
    expect((await prepare()).payload.worktree?.identity).toBe("feature:FEAT-020");
  });
});

describe("commit-progress", () => {
  it("commits each task once with its changeset, never commits logs, and pushes on completion", async () => {
    await configure(commitChain());
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(root, "code.txt"), "parent dirt\n");
    await fs.writeFile(path.join(tree.path, "code.txt"), "task one\n");
    const task = { root: tree.path, event: "implement.task.post", featureId: "FEAT-020", taskId: "TASK-001", extra: { summary: "Changed code" } };
    expect((await runEvent(task)).exitCode).toBe(0);
    const first = await git(tree.path, ["rev-parse", "HEAD"]);
    expect(await git(tree.path, ["log", "-1", "--format=%s"])).toBe("FEAT-020 TASK-001: Changed code");
    const committed = await git(tree.path, ["show", "--format=", "--name-only", "HEAD"]);
    expect(committed).toContain(`${featureDir}/changeset.json`);
    expect(committed).not.toContain("hooks.log.jsonl");
    // H3: a retry rewrites changeset.json identically, so there is nothing to commit.
    expect((await runEvent(task)).exitCode).toBe(0);
    expect(await git(tree.path, ["rev-parse", "HEAD"])).toBe(first);
    expect(await git(tree.path, ["status", "--porcelain"])).toBe("");
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).toBe("");
    expect(await fs.readFile(path.join(root, "code.txt"), "utf8")).toBe("parent dirt\n");

    expect((await complete(tree.path, "Finished feature")).exitCode).toBe(0);
    expect(await git(tree.path, ["rev-parse", "HEAD"])).toBe(first);
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).toContain(first);
    expect((await complete(tree.path, "Finished feature")).exitCode).toBe(0);
    expect(await git(tree.path, ["rev-parse", "HEAD"])).toBe(first);
  });

  it("stages deletions and new files, and commits and pushes a completed fix", async () => {
    await configure(commitChain());
    const tree = (await runEvent({ root, event: "fix.pre", extra: { name: "auth-issue" } })).payload.worktree!;
    await fs.remove(path.join(tree.path, "code.txt"));
    await fs.writeFile(path.join(tree.path, "new.txt"), "replacement\n");
    const report = await runEvent({ root: tree.path, event: "fix.post", extra: { name: "auth-issue", summary: "Fix auth issue" } });
    expect(report.exitCode).toBe(0);
    const changes = await git(tree.path, ["show", "--format=", "--name-status", "HEAD"]);
    expect(changes).toContain("D\tcode.txt");
    expect(changes).toContain("A\tnew.txt");
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).not.toBe("");
  });

  it("applies gitWorkflow.commitMessage", async () => {
    await configure(commitChain(), { fromBranch: "main", commitMessage: "feat(${id}): ${summary} [${task:-final}]" });
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "task\n");
    await runEvent({ root: tree.path, event: "implement.task.post", featureId: "FEAT-020", taskId: "TASK-001", extra: { summary: "Changed code" } });
    expect(await git(tree.path, ["log", "-1", "--format=%s"])).toBe("feat(FEAT-020): Changed code [TASK-001]");
  });

  it("keeps working while the main checkout is detached", async () => {
    await configure(commitChain());
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "task\n");
    await git(root, ["checkout", "--detach"]);
    expect((await runEvent({ root: tree.path, event: "implement.task.post", featureId: "FEAT-020", taskId: "TASK-001" })).exitCode).toBe(0);
  });

  it("refuses to commit in the main checkout", async () => {
    await configure(commitChain());
    const head = await git(root, ["rev-parse", "HEAD"]);
    const report = await runEvent({ root, event: "fix.post", extra: { summary: "Done" } });
    expect(report.exitCode).toBe(1);
    expect(await git(root, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("refuses to push a branch with no work outside .spec-lite", async () => {
    await configure(commitChain());
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(root, "code.txt"), "edited in the wrong checkout\n");
    const report = await complete(tree.path);
    expect(report.exitCode).toBe(1);
    expect(report.results.at(-1)?.message).toContain("no changes outside .spec-lite");
    expect(await git(tree.path, ["ls-remote", "--heads", "origin", tree.branch])).toBe("");
  });

  it("stops the chain after a failed push", async () => {
    await configure([...commitChain(), { name: "after-push", events: ["implement.post"], type: "prompt", prompt: "Should not run", order: 300 }], { fromBranch: "main", remote: "missing" });
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "done\n");
    const report = await complete(tree.path);
    expect(report.exitCode).toBe(1);
    expect(report.results.some((result) => result.name === "after-push")).toBe(false);
  });
});

describe("workflow validation", () => {
  it("rejects hand-written entries that break the chain, before anything runs", async () => {
    const check = async (hooks: HookDefinition[], expected: string) => {
      await configure(hooks);
      const messages = (await loadRegistry(root)).issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("\n");
      expect(messages).toContain(expected);
    };
    await check([{ ...enabled("prepare-worktree"), options: { fromBranch: "main" } } as HookDefinition], "must NOT have additional properties");
    await check([{ name: "prepare-worktree", type: "builtin", events: ["implement.pre", "implement.task.pre", "fix.pre"], onFailure: "abort" }], "must run first on implement.pre");
    await check([enabled("prepare-worktree", { onFailure: "warn" })], '"onFailure": "abort"');
    await check([enabled("prepare-worktree", { events: ["implement.pre"] })], "must subscribe to implement.task.pre, fix.pre");
    await check([enabled("commit-progress")], "commit-progress needs prepare-worktree");
    await check([...commitChain(), enabled("create-pull-request", { order: 150 })], "must run after commit-progress");
    await check(fullChain(), "gitWorkflow.pullRequest.targetBranch");
    const report = await prepare();
    expect(report.exitCode).toBe(2);
    expect(await fs.pathExists(path.join(root, ".worktrees"))).toBe(false);
  });

  it("validates the gitWorkflow block", () => {
    const { errors, warnings } = validateGitWorkflowConfig({ fetch: true, branch: "x", remote: "-x", worktreeRoot: ".", commitMessage: "${feature}: ${summary}" }, false);
    expect(errors.join("\n")).toContain("gitWorkflow.branch is not a recognized setting");
    expect(errors.join("\n")).toContain("gitWorkflow.remote must be a non-empty name");
    expect(errors.join("\n")).toContain("gitWorkflow.fetch needs gitWorkflow.fromBranch");
    expect(errors.join("\n")).toContain("gitWorkflow.worktreeRoot");
    expect(errors.join("\n")).toContain("${feature}");
    expect(warnings.join("\n")).toContain("fromBranch is not set");
    const command = validateGitWorkflowConfig({ fromBranch: "main", pullRequest: { provider: "command", targetBranch: "main", command: ["node"] } }, true);
    expect(command.errors.join("\n")).toContain("lookupCommand");
    expect(validateGitWorkflowConfig({ fromBranch: "main", pullRequest: { provider: "github", targetBranch: "main" } }, true)).toEqual({ errors: [], warnings: [] });
  });

  it("enables the workflow in one command and refuses changes that would break it", async () => {
    await fs.outputJson(path.join(root, ".spec-lite.json"), { gitWorkflow: { fromBranch: "main" } });
    const file = path.join(root, ".spec-lite", "hooks.json");
    await expect(setHooksEnabled(root, ["commit-progress"], true)).rejects.toThrow("needs prepare-worktree");
    await expect(setHooksEnabled(root, [...GIT_WORKFLOW_HOOKS], true)).rejects.toThrow("pullRequest.targetBranch");
    expect(await fs.pathExists(file)).toBe(false);
    await setHooksEnabled(root, ["prepare-worktree", "commit-progress"], true);
    expect((await loadRegistry(root)).hooks.map((hook) => hook.name)).toContain("commit-progress");
    await expect(setHooksEnabled(root, ["prepare-worktree"], false)).rejects.toThrow("needs prepare-worktree");
    await setHooksEnabled(root, ["commit-progress", "prepare-worktree"], false);
    expect((await loadRegistry(root)).hooks.map((hook) => hook.name)).toEqual(["capture-baseline", "capture-changeset"]);
  });
});

describe("temporary hook suppression", () => {
  it.each(["skip", "env"])("suppresses Git workflows through %s without editing the registry", async (mode) => {
    const { options } = await customAdapter();
    await configure(fullChain(), { fromBranch: "main", pullRequest: options });
    const file = path.join(root, ".spec-lite", "hooks.json");
    const before = await fs.readFile(file, "utf8");
    if (mode === "env") vi.stubEnv("SPEC_LITE_SKIP_HOOKS", GIT_WORKFLOW_HOOKS.join(","));
    const skip = mode === "skip" ? [...GIT_WORKFLOW_HOOKS] : undefined;
    const report = await runEvent({ root, event: "implement.pre", featureId: "FEAT-020", skip });
    expect(report.exitCode).toBe(0);
    expect(report.results.find((result) => result.name === "prepare-worktree")?.status).toBe("skipped");
    expect(report.results.find((result) => result.name === "capture-baseline")?.status).toBe("ok");
    expect(await fs.pathExists(path.join(root, ".worktrees"))).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe(before);
    const completion = await runEvent({ root, event: "implement.post", featureId: "FEAT-020", skip, extra: { summary: "Done" } });
    expect(completion.exitCode).toBe(0);
    expect(completion.results.find((result) => result.name === "create-pull-request")?.status).toBe("skipped");
  });

  it("runs the Git workflow in YOLO like anywhere else", async () => {
    await configure([enabled("prepare-worktree")]);
    const report = await prepare({ mode: "yolo" });
    expect(report.results.find((result) => result.name === "prepare-worktree")?.status).toBe("ok");
    expect(report.payload.worktree).toBeDefined();
  });
});

async function customAdapter(createOperation = "create") {
  const script = path.join(temp, "adapter.cjs");
  const marker = path.join(temp, "prs.json");
  await fs.writeFile(script, `
const fs = require('node:fs');
const [operation, marker] = process.argv.slice(2);
const existing = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null;
if (operation === 'lookup-failed') { process.stderr.write('Lookup failed'); process.exit(1); }
if (operation === 'lookup') { process.stdout.write(JSON.stringify(existing && (existing.rows ?? {url: existing.url}))); }
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
  const options: PullRequestConfig = { provider: "command", targetBranch: "main", command: [process.execPath, script, createOperation, marker], lookupCommand: [process.execPath, script, "lookup", marker] };
  return { options, marker };
}

describe("create-pull-request", () => {
  async function finishedFeature(options: PullRequestConfig) {
    await configure(fullChain(), { fromBranch: "main", pullRequest: options });
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "finished\n");
    return tree;
  }

  it("requires an explicit target and provider, and fails before creating a worktree", async () => {
    await configure(fullChain());
    const report = await prepare();
    expect(report.exitCode).toBe(2);
    expect(report.registryIssues.join("\n")).toContain("pullRequest.targetBranch");
    expect(await fs.pathExists(path.join(root, ".worktrees"))).toBe(false);
  });

  it("creates once using a custom provider and returns cleanup guidance on retries", async () => {
    const { options, marker } = await customAdapter();
    const tree = await finishedFeature(options);
    const first = await runEvent({ root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Execute operations" }, skip: ["inactive-hook"] });
    expect(first.exitCode).toBe(0);
    const data = await fs.readJson(marker);
    expect(data.creates).toBe(1);
    expect(data.head).toBe(tree.branch);
    expect(data.base).toBe("main");
    expect(data.title).toBe("FEAT-020: Execute operations");
    expect(data.body).toContain("Execute operations");
    expect(data.depth).toBe("1");
    expect(data.skip).toBe("inactive-hook");
    expect(first.results.at(-1)?.message).toContain(`spec-lite worktree cleanup ${featureTree}`);
    const second = await complete(tree.path, "Execute operations");
    expect(second.exitCode).toBe(0);
    expect(second.results.at(-1)?.message).toContain("Existing pull request");
    expect((await fs.readJson(marker)).creates).toBe(1);
  });

  it("recovers a lost creation response by querying again instead of creating twice", async () => {
    const { options, marker } = await customAdapter("lost-response");
    const tree = await finishedFeature(options);
    expect((await complete(tree.path)).exitCode).toBe(0);
    expect((await complete(tree.path)).exitCode).toBe(0);
    expect((await fs.readJson(marker)).creates).toBe(1);
  });

  it("does not create when the branch has not been pushed or the lookup fails", async () => {
    const { options, marker } = await customAdapter();
    const tree = await finishedFeature(options);
    const unpushed = await runEvent({ root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Done" }, skip: ["commit-progress"] });
    expect(unpushed.exitCode).toBe(1);
    expect(unpushed.results.at(-1)?.message).toContain("Push the completed branch");
    const failing = [options.lookupCommand![0], options.lookupCommand![1], "lookup-failed", marker];
    await configure(fullChain(), { fromBranch: "main", pullRequest: { ...options, lookupCommand: failing } }, tree.path);
    expect((await complete(tree.path)).exitCode).toBe(1);
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it("refuses to push new work onto a merged pull request, but treats an unchanged retry as done", async () => {
    const { options, marker } = await customAdapter();
    const tree = await finishedFeature(options);
    expect((await complete(tree.path)).exitCode).toBe(0);
    const head = await git(tree.path, ["rev-parse", "HEAD"]);
    await fs.writeJson(marker, { rows: [{ url: "https://forge.example/pr/123", state: "merged", headSha: head }] });
    const retry = await complete(tree.path);
    expect(retry.exitCode).toBe(0);
    expect(retry.results.at(-1)?.message).toContain("Existing merged pull request");
    await fs.writeFile(path.join(tree.path, "code.txt"), "more work\n");
    const more = await complete(tree.path);
    expect(more.exitCode).toBe(1);
    expect(more.results.at(-1)?.message).toContain("is merged, and the branch has commits it does not contain");
  });

  it("prefers an open pull request over older closed ones", async () => {
    const { options, marker } = await customAdapter();
    const tree = await finishedFeature(options);
    await fs.writeJson(marker, { rows: [
      { url: "https://forge.example/pr/1", state: "closed", headSha: "0".repeat(40) },
      { url: "https://forge.example/pr/2", state: "open" },
    ] });
    const report = await complete(tree.path);
    expect(report.exitCode).toBe(0);
    expect(report.results.at(-1)?.message).toContain("Existing pull request: https://forge.example/pr/2");
  });

  it.each(["github", "azure-devops"] as const)("queries and creates through the %s adapter, then reuses its PR", async (provider) => {
    const tree = await finishedFeature({ provider, targetBranch: "main" });
    const realGit = workflow.git;
    vi.spyOn(workflow, "git").mockImplementation((directory, args, timeout) => {
      if (args[0] === "remote" && args[1] === "get-url") return Promise.resolve(provider === "github" ? "https://github.com/team/repo.git" : "https://dev.azure.com/team/project/_git/repo");
      return realGit(directory, args, timeout);
    });
    let created = false;
    const program = vi.spyOn(workflow, "runProgram").mockImplementation(async (_directory, bin, args) => {
      expect(bin).toBe(provider === "github" ? "gh" : "az");
      if (args.includes("list")) {
        if (!created) return "[]";
        return JSON.stringify([provider === "github" ? { url: "https://github.com/team/repo/pull/1", state: "OPEN" } : { pullRequestId: 1, status: "active" }]);
      }
      expect(args).toContain(provider === "github" ? "--base" : "--target-branch");
      expect(args).toContain("main");
      expect(args).toContain(tree.branch);
      created = true;
      return provider === "github" ? "https://github.com/team/repo/pull/1" : JSON.stringify({ pullRequestId: 1 });
    });
    expect((await complete(tree.path)).exitCode).toBe(0);
    expect((await complete(tree.path)).exitCode).toBe(0);
    expect(program.mock.calls.filter((call) => call[2].includes("create"))).toHaveLength(1);
  });

  it("skips PR creation when the target already contains the branch", async () => {
    const { options, marker } = await customAdapter();
    const tree = await finishedFeature(options);
    expect((await runEvent({ root: tree.path, event: "implement.post", featureId: "FEAT-020", extra: { summary: "Done" }, skip: ["create-pull-request"] })).exitCode).toBe(0);
    await git(root, ["push", "origin", `${tree.branch}:main`]);
    const report = await complete(tree.path);
    expect(report.exitCode).toBe(0);
    expect(report.results.at(-1)?.message).toContain("No changes against main");
    expect(await fs.pathExists(marker)).toBe(false);
  });
});

describe("Azure CLI on Windows", () => {
  it.runIf(process.platform === "win32")("runs az through its bundled Python so PR text never reaches cmd.exe", async () => {
    const cli = path.join(temp, "CLI2");
    await fs.outputFile(path.join(cli, "wbin", "az.cmd"), "@echo off\r\n");
    await fs.outputFile(path.join(cli, "python.exe"), "");
    const env = { Path: path.join(cli, "wbin") };
    const title = 'x "&echo PWNED>pwned.txt& " 100% %PATH%';
    expect(programInvocation("az", ["repos", "pr", "create", "--title", title], env))
      .toEqual({ bin: path.join(cli, "python.exe"), argv: ["-IBm", "azure.cli", "repos", "pr", "create", "--title", title] });
    await fs.remove(path.join(cli, "python.exe"));
    expect(() => programInvocation("az", [], env)).toThrow("never passed through cmd.exe");
    expect(() => programInvocation("az", [], { Path: temp })).toThrow("not found on PATH");
  });

  it.runIf(process.platform !== "win32")("runs az directly elsewhere", () => {
    expect(programInvocation("az", ["--title", "a & b"], {})).toEqual({ bin: "az", argv: ["--title", "a & b"] });
  });
});

describe("worktree cleanup", () => {
  it("refuses an unmerged workflow, then after merge removes everything and leaves the main checkout ready to pull", async () => {
    // A tracked input with an uncommitted edit (" M"), alongside untracked ones ("??").
    const memory = path.join(root, ".spec-lite", "memory.md");
    await fs.outputFile(memory, "# Memory\n");
    await git(root, ["add", ".spec-lite/memory.md"]);
    await git(root, ["commit", "-m", "memory"]);
    await git(root, ["push", "origin", "main"]);
    await fs.appendFile(memory, "- Prefer small functions\n");
    await configure(commitChain());
    const tree = (await prepare()).payload.worktree!;
    expect(await fs.readFile(path.join(tree.path, ".spec-lite", "memory.md"), "utf8")).toContain("small functions");
    await fs.writeFile(path.join(tree.path, "code.txt"), "feature\n");
    expect((await complete(tree.path)).exitCode).toBe(0);
    expect(await listWorkflows(root)).toEqual([expect.objectContaining({ name: featureTree, identity: "feature:FEAT-020", status: "active" })]);
    await expect(cleanupWorkflow(root, featureTree)).rejects.toThrow("is not merged into main");
    expect((await cleanupMerged(root)).join("\n")).toContain(`Skipped ${featureTree}`);
    expect(await fs.pathExists(tree.path)).toBe(true);

    await git(root, ["push", "origin", `${tree.branch}:main`]); // merged, as by a PR
    await expect(cleanupWorkflow(tree.path, featureTree)).rejects.toThrow("from the main checkout");
    const done = (await cleanupWorkflow(root, featureTree)).join("\n");
    expect(done).toContain("Removed worktree");
    expect(done).toContain(`Deleted branch ${tree.branch}`);
    expect(done).toContain(`Reset ${featureDir}/spec.md`);
    expect(done).toContain("Reset .spec-lite/memory.md");
    expect(await fs.pathExists(tree.path)).toBe(false);
    expect(await localBranchExists(root, tree.branch)).toBe(false);
    expect(await listWorkflows(root)).toEqual([]);
    // H4: no tracked file was edited and copied specs were reset, so the pull is clean.
    await git(root, ["pull", "--ff-only", "origin", "main"]);
    expect(await fs.readFile(path.join(root, "code.txt"), "utf8")).toBe("feature\n");
    expect(await git(root, ["status", "--porcelain"])).toBe("");

    const next = await prepare();
    expect(next.exitCode).toBe(0);
    expect(next.payload.worktree?.initialHead).toBe(await git(root, ["rev-parse", "main"]));
  });

  it("accepts a squash merge only when the provider reports that exact commit merged", async () => {
    const { options, marker } = await customAdapter();
    await configure(fullChain(), { fromBranch: "main", pullRequest: options });
    const tree = (await prepare()).payload.worktree!;
    await fs.writeFile(path.join(tree.path, "code.txt"), "feature\n");
    expect((await complete(tree.path)).exitCode).toBe(0);
    const tip = await git(root, ["rev-parse", tree.branch]);
    await fs.writeJson(marker, { rows: [{ url: "https://forge.example/pr/123", state: "merged", headSha: "0".repeat(40) }] });
    await expect(cleanupWorkflow(root, featureTree)).rejects.toThrow("did not merge");
    expect(await localBranchExists(root, tree.branch)).toBe(true);
    await fs.writeJson(marker, { rows: [{ url: "https://forge.example/pr/123", state: "merged", headSha: tip }] });
    expect((await cleanupWorkflow(root, featureTree)).join("\n")).toContain("pull request https://forge.example/pr/123 merged");
    expect(await localBranchExists(root, tree.branch)).toBe(false);
  });
});
