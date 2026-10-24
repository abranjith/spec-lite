import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { runEvent } from "../src/hooks/runner.js";
import { loadRegistry } from "../src/hooks/registry.js";
import { getEvent } from "../src/hooks/events.js";
import { validateTemplate } from "../src/hooks/interpolation.js";
import { migrateHookRequires } from "../src/hooks/migration.js";
import { changesetLocation } from "../src/hooks/workspace.js";
import { git } from "../src/hooks/builtins/git-workflow.js";
import * as workflow from "../src/hooks/builtins/git-workflow.js";
import type { ControlResult } from "../src/hooks/control/types.js";

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

let root: string;
const featureDir = ".spec-lite/features/FEAT-001-demo";
const hooksFile = () => path.join(root, ".spec-lite", "hooks.json");

async function hooks(entries: unknown[]): Promise<void> {
  await fs.outputJson(hooksFile(), { version: 1, hooks: entries });
}

/** A command hook that leaves a marker file, so a test can tell it ran. */
const marker = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  events: ["implement.post"],
  type: "command",
  run: `node -e "require('fs').writeFileSync('${name}.ran', '')"`,
  ...extra,
});
const ran = (name: string) => fs.pathExists(path.join(root, `${name}.ran`));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-change-"));
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  for (const key of [
    "SPEC_LITE_SKIP_HOOKS",
    "SPEC_LITE_HOOK_DEPTH",
    "SPEC_LITE_HOOK_CHAIN",
  ])
    vi.stubEnv(key, "");
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "t@local.test"]);
  await git(root, ["config", "user.name", "test"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await fs.outputFile(path.join(root, "code.txt"), "base\n");
  await fs.outputFile(path.join(root, featureDir, "spec.md"), "# Demo\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "initial"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.remove(root);
});

describe("requires", () => {
  it("skips a hook on a run without the group, and the rest of the event still runs", async () => {
    await hooks([
      marker("needs-feature", {
        requires: ["feature"],
        run: `node -e "require('fs').writeFileSync('needs-feature.ran', process.argv[1])" \${feature.spec}`,
      }),
      marker("always"),
    ]);
    expect((await loadRegistry(root)).issues).toEqual([]);

    const plan = await runEvent({
      root,
      event: "implement.post",
      extra: { plan: ".spec-lite/plan.md", summary: "Plan done" },
    });
    expect(plan.exitCode).toBe(0);
    const skipped = plan.results.find((r) => r.name === "needs-feature");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.message).toBe(
      "requires feature, which this run does not carry"
    );
    expect(await ran("needs-feature")).toBe(false);
    expect(await ran("always")).toBe(true);

    const feature = await runEvent({
      root,
      event: "implement.post",
      featureId: "FEAT-001",
      extra: { summary: "Feature done" },
    });
    expect(feature.exitCode).toBe(0);
    expect(
      feature.results.find((r) => r.name === "needs-feature")?.status
    ).toBe("ok");
    expect(
      await fs.readFile(path.join(root, "needs-feature.ran"), "utf8")
    ).toBe(`${featureDir}/spec.md`);
  });

  it("runs a change-only hook only on Change Mode runs, with ${change.name}", async () => {
    await hooks([
      marker("change-only", {
        requires: ["change"],
        run: `node -e "require('fs').writeFileSync('change-only.ran', process.argv[1])" \${change.name}`,
      }),
    ]);
    expect((await loadRegistry(root)).issues).toEqual([]);
    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    expect(await ran("change-only")).toBe(false);
    const change = await runEvent({
      root,
      event: "implement.post",
      extra: { change: "add-json-flag" },
    });
    expect(change.exitCode).toBe(0);
    expect(await fs.readFile(path.join(root, "change-only.ran"), "utf8")).toBe(
      "add-json-flag"
    );
  });

  it("lets hook validate accept the group's variables, and names the fix when it is missing", () => {
    const post = [getEvent("implement.post")!];
    expect(
      validateTemplate("${feature.spec}", post, "run", ["feature"]).errors
    ).toEqual([]);
    const [error] = validateTemplate("${feature.spec}", post, "run").errors;
    expect(error).toContain('Add "requires": ["feature"]');
  });

  it("rejects an unknown group as a registry error", async () => {
    await hooks([marker("typo", { requires: ["features"] })]);
    const { issues } = await loadRegistry(root);
    expect(issues.some((i) => i.level === "error")).toBe(true);
  });

  it("skips in a tracked run too", async () => {
    await hooks([
      { name: "capture-baseline", enabled: false },
      { name: "capture-changeset", enabled: false },
      marker("needs-feature", {
        events: ["implement.pre"],
        requires: ["feature"],
        run: "echo ${feature.id}",
      }),
    ]);
    const pre = (await runEvent({
      root,
      event: "implement.pre",
      tracked: true,
      extra: { change: "add-json-flag" },
    })) as unknown as ControlResult;
    expect(pre.status).toBe("continue");
    expect(pre.results.find((r) => r.name === "needs-feature")?.status).toBe(
      "skipped"
    );
  });
});

describe("migrateHookRequires", () => {
  it("adds requires where a withdrawn promise was relied on, and nowhere else", async () => {
    await hooks([
      {
        name: "review-after-implement",
        events: ["implement.post"],
        type: "skill",
        skill: "review",
        args: "review feature ${feature.name}",
      },
      {
        name: "files-and-feature",
        events: ["implement.*"],
        type: "command",
        run: "echo ${feature.id} ${changes.files}",
      },
      {
        name: "fix-files",
        events: ["fix.post"],
        type: "command",
        run: "echo ${changes.count} ${summary}",
      },
      {
        name: "with-fallback",
        events: ["implement.post"],
        type: "command",
        run: "echo ${feature.id:-none}",
      },
      {
        name: "still-promised",
        events: ["plan-feature.post"],
        type: "command",
        run: "echo ${feature.id}",
      },
      { name: "capture-changeset", enabled: false },
    ]);
    const before = await fs.readJson(hooksFile());

    const changes = await migrateHookRequires(hooksFile());
    expect(changes).toEqual([
      { hook: "review-after-implement", added: ["feature"] },
      { hook: "files-and-feature", added: ["feature", "changes"] },
      { hook: "fix-files", added: ["changes"] },
    ]);
    const after = await fs.readJson(hooksFile());
    expect(Object.keys(after.hooks[0])).toEqual([
      "name",
      "events",
      "requires",
      "type",
      "skill",
      "args",
    ]);
    expect(after.hooks.slice(3)).toEqual(before.hooks.slice(3));
    expect((await loadRegistry(root)).issues).toEqual([]);

    expect(await migrateHookRequires(hooksFile())).toEqual([]);
  });

  it("covers checkpoint option templates, which validate like any other field", async () => {
    await hooks([
      {
        name: "after-implement",
        events: ["implement.post"],
        type: "builtin",
        builtin: "checkpoint",
        options: {
          question: "Review ${feature.name} now?",
          choices: {
            review: {
              description: "Review it",
              skill: "review",
              args: "review feature ${feature.name}",
            },
            stop: { description: "Stop", stop: true },
          },
        },
      },
    ]);
    expect(
      (await loadRegistry(root)).issues.some((i) => i.level === "error")
    ).toBe(true);
    expect(await migrateHookRequires(hooksFile())).toEqual([
      { hook: "after-implement", added: ["feature"] },
    ]);
    expect((await loadRegistry(root)).issues).toEqual([]);
  });

  it("leaves a missing or unreadable file alone", async () => {
    expect(await migrateHookRequires(hooksFile())).toEqual([]);
    await fs.outputFile(hooksFile(), "{ not json");
    expect(await migrateHookRequires(hooksFile())).toEqual([]);
    expect(await fs.readFile(hooksFile(), "utf8")).toBe("{ not json");
  });
});

describe("changesets for work without a feature", () => {
  it("places them by run: feature, change, or fix", () => {
    expect(
      changesetLocation({ role: "implement", feature: { dir: featureDir } })
    ).toBe(featureDir);
    expect(changesetLocation({ role: "implement", change: "add-flag" })).toBe(
      ".spec-lite/reviews/changeset/chg_add-flag.json"
    );
    expect(changesetLocation({ role: "fix", name: "PROJ-123" })).toBe(
      ".spec-lite/reviews/changeset/fix_PROJ-123.json"
    );
    expect(
      changesetLocation({
        role: "fix",
        name: "auth",
        feature: { dir: featureDir },
      })
    ).toBe(featureDir);
    // Review Mode's name is a review scope, not a fix.
    expect(changesetLocation({ role: "implement", name: "orders" })).toBe(
      undefined
    );
    for (const name of ["../escape", "a/b", "..", ".hidden", "x..y"])
      expect(changesetLocation({ role: "fix", name })).toBe(undefined);
  });

  it("captures a change run and hands its files to implement.post hooks", async () => {
    await hooks([
      {
        name: "list-files",
        events: ["implement.post"],
        type: "command",
        requires: ["changes"],
        run: `node -e "require('fs').writeFileSync('files.txt', process.argv[1])" \${changes.files}`,
      },
    ]);
    const extra = { change: "add-json-flag" };
    expect(
      (await runEvent({ root, event: "implement.pre", extra })).exitCode
    ).toBe(0);
    await fs.writeFile(path.join(root, "code.txt"), "changed\n");
    const post = await runEvent({
      root,
      event: "implement.post",
      extra: { ...extra, summary: "Add --json" },
    });
    expect(post.exitCode).toBe(0);
    const doc = await fs.readJson(
      path.join(root, ".spec-lite/reviews/changeset/chg_add-json-flag.json")
    );
    expect(doc.files.map((f: { path: string }) => f.path)).toEqual([
      "code.txt",
    ]);
    expect(post.payload.changes?.files.map((f) => f.path)).toEqual([
      "code.txt",
    ]);
    expect(await fs.readFile(path.join(root, "files.txt"), "utf8")).toBe(
      "code.txt"
    );
  });

  it("captures a fix without a feature to its own file, and a fix with one to the feature", async () => {
    await runEvent({ root, event: "fix.pre", extra: { name: "auth-issue" } });
    await fs.writeFile(path.join(root, "code.txt"), "fixed\n");
    await runEvent({ root, event: "fix.post", extra: { name: "auth-issue" } });
    const fix = await fs.readJson(
      path.join(root, ".spec-lite/reviews/changeset/fix_auth-issue.json")
    );
    expect(fix.files.map((f: { path: string }) => f.path)).toEqual([
      "code.txt",
    ]);

    await runEvent({
      root,
      event: "fix.pre",
      featureId: "FEAT-001",
      extra: { name: "demo-bug" },
    });
    await fs.writeFile(path.join(root, "other.txt"), "new\n");
    await runEvent({
      root,
      event: "fix.post",
      featureId: "FEAT-001",
      extra: { name: "demo-bug" },
    });
    expect(
      await fs.pathExists(path.join(root, featureDir, "changeset.json"))
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(root, ".spec-lite/reviews/changeset/fix_demo-bug.json")
      )
    ).toBe(false);
  });

  it("skips capture for a fix whose name is not a safe file name", async () => {
    const pre = await runEvent({
      root,
      event: "fix.pre",
      extra: { name: "../outside" },
    });
    expect(pre.exitCode).toBe(0);
    expect(
      pre.results.find((r) => r.name === "capture-baseline")?.message
    ).toContain("changeset capture skipped");
    expect(await fs.pathExists(path.join(root, ".spec-lite/reviews"))).toBe(
      false
    );
  });
});

describe("the change scope", () => {
  const disabled = [
    { name: "capture-baseline", enabled: false },
    { name: "capture-changeset", enabled: false },
  ];
  const tracked = async (event: string, opts: Record<string, unknown>) =>
    (await runEvent({
      root,
      event,
      tracked: true,
      ...opts,
    })) as unknown as ControlResult;

  it("refuses --feature and unsafe names in a tracked run", async () => {
    await hooks(disabled);
    const both = await tracked("implement.pre", {
      featureId: "FEAT-001",
      extra: { change: "add-json-flag" },
    });
    expect(both.exitCode).toBe(2);
    expect(both.error?.message).toContain("does not take --feature");
    const unsafe = await tracked("implement.pre", {
      extra: { change: "../escape" },
    });
    expect(unsafe.exitCode).toBe(2);
    expect(unsafe.error?.message).toContain("names a file");
  });

  it("is inherited by later events of the execution and cannot be changed", async () => {
    await hooks([]);
    const pre = await tracked("implement.pre", {
      extra: { change: "add-json-flag" },
    });
    expect(pre.status).toBe("continue");
    await fs.writeFile(path.join(root, "code.txt"), "changed\n");
    const swap = await tracked("implement.post", {
      execution: pre.executionId,
      extra: { change: "other", summary: "x" },
    });
    expect(swap.exitCode).toBe(2);
    expect(swap.error?.message).toBe("Event cannot change saved change.");

    const post = await tracked("implement.post", {
      execution: pre.executionId,
      extra: { summary: "Add --json" },
    });
    expect(post.status).toBe("continue");
    expect(post.payload?.change).toBe("add-json-flag");
    const doc = await fs.readJson(
      path.join(root, ".spec-lite/reviews/changeset/chg_add-json-flag.json")
    );
    expect(doc.files.map((f: { path: string }) => f.path)).toEqual([
      "code.txt",
    ]);
  });

  it("names the workflow change:<name> on a chg/ branch", () => {
    const work = workflow.workItem({ change: "Add-JSON-flag" } as never);
    expect(work).toMatchObject({
      kind: "change",
      name: "change-add-json-flag",
      identity: "change:add-json-flag",
      branch: "chg/add-json-flag",
    });
    expect(() =>
      workflow.workItem({
        change: "x",
        feature: { id: "FEAT-001", dir: featureDir },
      } as never)
    ).toThrow("does not take --feature");
  });

  it("continues on another workflow's branch when started inside its worktree", async () => {
    await hooks([
      {
        name: "prepare-worktree",
        enabled: true,
        options: { fromBranch: "main" },
      },
    ]);
    const feature = await runEvent({
      root,
      event: "implement.pre",
      featureId: "FEAT-001",
    });
    const tree = feature.payload.worktree!;
    const change = await runEvent({
      root: tree.path,
      event: "implement.pre",
      extra: { change: "add-json-flag" },
    });
    expect(change.exitCode).toBe(0);
    expect(change.payload.worktree?.path).toBe(tree.path);
    expect(change.payload.worktree?.branch).toBe(tree.branch);
  });

  it("creates the change's worktree with its change record", async () => {
    await hooks([
      {
        name: "prepare-worktree",
        enabled: true,
        options: { fromBranch: "main" },
      },
    ]);
    await fs.outputFile(
      path.join(root, ".spec-lite/reviews/chg_add-json-flag.md"),
      "# Change: Add --json\n"
    );
    const pre = await runEvent({
      root,
      event: "implement.pre",
      extra: { change: "add-json-flag" },
    });
    expect(pre.exitCode).toBe(0);
    const tree = pre.payload.worktree!;
    expect(tree.branch).toBe("chg/add-json-flag");
    expect(tree.identity).toBe("change:add-json-flag");
    expect(
      await fs.pathExists(
        path.join(tree.path, ".spec-lite/reviews/chg_add-json-flag.md")
      )
    ).toBe(true);
  });
});
