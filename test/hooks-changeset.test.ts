import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { captureBaseline, captureChangeset, type ChangesetDoc } from "../src/hooks/changeset.js";

const execFileAsync = promisify(execFile);

let root: string;
const FEATURE_DIR = ".spec-lite/features/FEAT-001-demo";

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout;
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, content, "utf-8");
}

async function changesetDoc(): Promise<ChangesetDoc> {
  return fs.readJson(path.join(root, FEATURE_DIR, "changeset.json"));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-changeset-"));
  await git("init", "-q");
  await git("config", "user.email", "test@test.local");
  await git("config", "user.name", "test");
  await write("legacy.ts", "line1\n");
  await git("add", "legacy.ts");
  await git("commit", "-q", "-m", "init");
  await fs.ensureDir(path.join(root, FEATURE_DIR));
});

afterEach(async () => {
  await fs.remove(root);
});

describe("changeset capture — the core deterministic-tracking claim", () => {
  it("excludes a file that was already dirty at baseline and stays untouched", async () => {
    await write("legacy.ts", "line1\npredirty\n");

    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.pre" });
    await write("new_tracked.ts", "new\n");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.post", role: "implement" });

    const doc = await changesetDoc();
    const paths = doc.files.map((f) => f.path);
    expect(paths).toContain("new_tracked.ts");
    expect(paths).not.toContain("legacy.ts");
  });

  it("includes a file that was dirty at baseline but edited further during the run", async () => {
    await write("legacy.ts", "line1\npredirty\n");
    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.pre" });

    // Further edit during the run — this is genuinely this run's work and
    // must not be silently dropped just because the file was already dirty.
    await write("legacy.ts", "line1\npredirty\ntracked edit during run\n");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.post", role: "implement" });

    const doc = await changesetDoc();
    const entry = doc.files.find((f) => f.path === "legacy.ts");
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("M");
  });

  it("does not attribute a file's edits to the wrong task across two implement.task cycles", async () => {
    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.task.pre" });
    await write("a.ts", "task1\n");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.task.post", role: "implement", task: "TASK-001" });

    // A second .pre must NOT reset the baseline — otherwise task 1's own
    // changes would become task 2's "pre-existing dirt" and vanish.
    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.task.pre" });
    await write("b.ts", "task2\n");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.task.post", role: "implement", task: "TASK-002" });

    const doc = await changesetDoc();
    const a = doc.files.find((f) => f.path === "a.ts");
    const b = doc.files.find((f) => f.path === "b.ts");
    expect(a?.task).toBe("TASK-001");
    expect(b?.task).toBe("TASK-002");
  });

  it("does not collapse a pre-existing untracked directory, so new work inside it is still visible", async () => {
    // A whole untracked directory exists before the run starts.
    await write("src/newmodule/draft.ts", "old draft\n");
    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.pre" });

    // The old file is left untouched; a new file is added alongside it.
    await write("src/newmodule/new_during_run.ts", "brand new\n");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.post", role: "implement" });

    const doc = await changesetDoc();
    const paths = doc.files.map((f) => f.path);
    expect(paths).toContain("src/newmodule/new_during_run.ts");
    expect(paths).not.toContain("src/newmodule/draft.ts");
  });

  it("excludes generated output, lockfiles, and .spec-lite/ itself", async () => {
    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.pre" });
    await write("dist/bundle.js", "built\n");
    await write("package-lock.json", "{}\n");
    await write("src/real.ts", "real work\n");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.post", role: "implement" });

    const doc = await changesetDoc();
    const paths = doc.files.map((f) => f.path);
    expect(paths).toContain("src/real.ts");
    expect(paths).not.toContain("dist/bundle.js");
    expect(paths).not.toContain("package-lock.json");
    expect(doc.excluded).toEqual(expect.arrayContaining(["dist/bundle.js", "package-lock.json"]));
  });

  it("captures a committed file as added", async () => {
    await captureBaseline(root, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.pre" });
    await write("new_tracked.ts", "new\n");
    await git("add", "new_tracked.ts");
    await git("commit", "-q", "-m", "add new_tracked");
    await captureChangeset(root, FEATURE_DIR, { event: "implement.post", role: "implement" });

    const doc = await changesetDoc();
    const entry = doc.files.find((f) => f.path === "new_tracked.ts");
    expect(entry?.status).toBe("A");
  });

  it("distinguishes 'no baseline' from 'not a git repo' in its reason", async () => {
    // The repo IS git; the *.pre event simply never ran. Reporting "not a git
    // repository" here would send the user debugging the wrong problem.
    const doc = await captureChangeset(root, FEATURE_DIR, { event: "implement.post", role: "implement" });
    expect(doc.noBaselineReason).toContain("no baseline recorded");
    expect(doc.noBaselineReason).not.toContain("not a git repository");
  });

  it("falls back to vcs: none outside a git repository", async () => {
    const bareRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-nogit-"));
    try {
      await fs.ensureDir(path.join(bareRoot, FEATURE_DIR));
      const doc = await captureBaseline(bareRoot, FEATURE_DIR, { featureId: "FEAT-001", event: "implement.pre" });
      expect(doc.vcs).toBe("none");
    } finally {
      await fs.remove(bareRoot);
    }
  });
});
