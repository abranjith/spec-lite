import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { planFeatureMigration, runFeatureMigration } from "../src/utils/feature-migration.js";

const execFileAsync = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-migrate-"));
});

afterEach(async () => {
  await fs.remove(root);
});

async function writeFeature(name: string, id: string): Promise<void> {
  const dir = path.join(root, ".spec-lite", "features");
  await fs.ensureDir(dir);
  await fs.writeFile(
    path.join(dir, `feature_${name}.md`),
    `# Feature: ${name}\n\n## 1. Feature Goal\n\n**ID**: ${id}\n`,
    "utf-8"
  );
}

describe("planFeatureMigration", () => {
  it("finds flat feature_<name>.md files and computes their target directory", async () => {
    await writeFeature("user_management", "FEAT-001");
    const moves = await planFeatureMigration(root);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toBe(".spec-lite/features/FEAT-001-user_management/spec.md");
  });

  it("does not touch unit_tests_<name>.md or integration_tests_<name>.md", async () => {
    const dir = path.join(root, ".spec-lite", "features");
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, "unit_tests_search.md"), "# unit tests\n", "utf-8");
    await fs.writeFile(path.join(dir, "integration_tests_search.md"), "# integration tests\n", "utf-8");
    const moves = await planFeatureMigration(root);
    expect(moves).toHaveLength(0);
  });

  it("skips a feature file with no discoverable ID rather than guessing", async () => {
    const dir = path.join(root, ".spec-lite", "features");
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, "feature_orphan.md"), "# Feature: orphan\nno id here\n", "utf-8");
    const moves = await planFeatureMigration(root);
    expect(moves).toHaveLength(0);
  });

  it("is a no-op on an already-migrated (directory-based) feature", async () => {
    const dir = path.join(root, ".spec-lite", "features", "FEAT-002-search");
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, "spec.md"), "**ID**: FEAT-002\n", "utf-8");
    const moves = await planFeatureMigration(root);
    expect(moves).toHaveLength(0);
  });
});

describe("runFeatureMigration", () => {
  it("moves the file and rewrites plan Spec File cells and feature-summary links", async () => {
    await writeFeature("user_management", "FEAT-001");
    // Plan files live in .spec-lite/, not the repo root — this fixture must
    // match reality, or a bug here scanning the wrong directory would pass
    // silently the same way it did before this test was fixed.
    await fs.ensureDir(path.join(root, ".spec-lite"));
    await fs.writeFile(
      path.join(root, ".spec-lite", "plan.md"),
      "| ID | Feature | Spec File | Status |\n" +
      "|---|---|---|---|\n" +
      "| FEAT-001 | User Management | `features/feature_user_management.md` | [x] Complete |\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(root, ".spec-lite", "feature-summary.md"),
      "**FEAT-001 — User Management**\n" +
      "Source spec: [feature_user_management.md](.spec-lite/features/feature_user_management.md)\n",
      "utf-8"
    );

    const moves = await planFeatureMigration(root);
    const result = await runFeatureMigration(root, moves);

    expect(await fs.pathExists(path.join(root, ".spec-lite", "features", "feature_user_management.md"))).toBe(false);
    expect(await fs.pathExists(path.join(root, ".spec-lite", "features", "FEAT-001-user_management", "spec.md"))).toBe(true);

    const planContent = await fs.readFile(path.join(root, ".spec-lite", "plan.md"), "utf-8");
    expect(planContent).toContain("features/FEAT-001-user_management/spec.md");
    expect(planContent).not.toContain("features/feature_user_management.md");
    expect(result.planFilesRewritten).toContain(".spec-lite/plan.md");

    const summaryContent = await fs.readFile(path.join(root, ".spec-lite", "feature-summary.md"), "utf-8");
    expect(summaryContent).toContain("features/FEAT-001-user_management/spec.md");
    expect(result.featureSummaryRewritten).toBe(true);
  });

  it("uses git mv when the workspace is a git repo, so history follows the move", async () => {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "t@t.local"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
    await writeFeature("search", "FEAT-003");
    await execFileAsync("git", ["add", "-A"], { cwd: root });
    await execFileAsync("git", ["commit", "-q", "-m", "add feature"], { cwd: root });

    const moves = await planFeatureMigration(root);
    await runFeatureMigration(root, moves);
    // git mv only stages the rename; a commit is needed before `log --follow`
    // has any history to trace through it.
    await execFileAsync("git", ["commit", "-q", "-m", "migrate feature layout"], { cwd: root });

    const log = await execFileAsync("git", ["log", "--follow", "--format=%H", "--", ".spec-lite/features/FEAT-003-search/spec.md"], { cwd: root });
    const commits = log.stdout.trim().split("\n").filter(Boolean);
    // Both the migration commit and the original "add feature" commit must
    // be visible — that's what proves --follow traced through the rename.
    expect(commits.length).toBe(2);
  });
});
