/**
 * Migrates flat `.spec-lite/features/feature_<name>.md` files to the
 * ID-prefixed directory layout `.spec-lite/features/FEAT-###-<name>/spec.md`,
 * and rewrites the two places that link to the old path: plan `Spec File`
 * cells and `feature-summary.md` `Source spec:` links.
 *
 * `unit_tests_<name>.md` and `integration_tests_<name>.md` are deliberately
 * left flat — their producing skills are not part of the v1 hook-wired set,
 * and standalone (Mode A) unit-test specs have no owning feature to move into.
 *
 * Uses `git mv` when the workspace is a git repo, so file history follows the
 * move; falls back to a plain filesystem move otherwise.
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";

const execFileAsync = promisify(execFile);

const FLAT_FEATURE_RE = /^feature_(.+)\.md$/;

export interface PlannedMove {
  /** feature_<name>.md, workspace-relative */
  from: string;
  /** FEAT-###-<name>/spec.md, workspace-relative */
  to: string;
  featureId: string;
  name: string;
}

async function isGitRepo(root: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/** Extract `**ID**: FEAT-###` from a feature spec's content. */
function extractFeatureId(content: string): string | undefined {
  const match = /\*\*ID\*\*:\s*(FEAT-\d+)/i.exec(content);
  return match?.[1]?.toUpperCase();
}

/** Find every legacy flat feature spec and compute where it should move to. */
export async function planFeatureMigration(root: string): Promise<PlannedMove[]> {
  const featuresDir = path.join(root, ".spec-lite", "features");
  if (!(await fs.pathExists(featuresDir))) return [];

  const entries = await fs.readdir(featuresDir);
  const moves: PlannedMove[] = [];

  for (const entry of entries) {
    const match = FLAT_FEATURE_RE.exec(entry);
    if (!match) continue;
    const absPath = path.join(featuresDir, entry);
    if ((await fs.stat(absPath)).isDirectory()) continue;

    const content = await fs.readFile(absPath, "utf-8");
    const featureId = extractFeatureId(content);
    if (!featureId) continue; // can't place it without a stable ID; leave it for manual attention

    const name = match[1];
    const dirName = `${featureId}-${name}`;
    moves.push({
      from: path.join(".spec-lite", "features", entry).split(path.sep).join("/"),
      to: path.join(".spec-lite", "features", dirName, "spec.md").split(path.sep).join("/"),
      featureId,
      name,
    });
  }

  return moves;
}

export interface MigrationResult {
  moved: PlannedMove[];
  planFilesRewritten: string[];
  featureSummaryRewritten: boolean;
}

/** Both forms a link to a feature spec might appear in: workspace-relative and .spec-lite-relative. */
function linkForms(move: PlannedMove): { oldForms: string[]; newForm: string } {
  const specLiteRelativeOld = move.from.replace(/^\.spec-lite\//, "");
  const specLiteRelativeNew = move.to.replace(/^\.spec-lite\//, "");
  return { oldForms: [move.from, specLiteRelativeOld], newForm: specLiteRelativeNew };
}

async function rewritePlanSpecFileCells(root: string, moves: PlannedMove[]): Promise<string[]> {
  const rewritten: string[] = [];
  const specLiteDir = path.join(root, ".spec-lite");
  const entries = await fs.readdir(specLiteDir).catch(() => [] as string[]);
  const planFiles = entries.filter((f) => /^plan.*\.md$/i.test(f));

  for (const file of planFiles) {
    const abs = path.join(specLiteDir, file);
    let content = await fs.readFile(abs, "utf-8");
    let changed = false;

    for (const move of moves) {
      // Plan files store the Spec File cell relative to .spec-lite/ itself
      // ("features/feature_x.md"), not workspace-relative — match both forms.
      const { oldForms, newForm } = linkForms(move);
      for (const oldForm of oldForms) {
        if (content.includes(oldForm)) {
          content = content.split(oldForm).join(newForm);
          changed = true;
        }
      }
    }

    if (changed) {
      await fs.writeFile(abs, content, "utf-8");
      rewritten.push(path.join(".spec-lite", file).split(path.sep).join("/"));
    }
  }

  return rewritten;
}

async function rewriteFeatureSummaryLinks(root: string, moves: PlannedMove[]): Promise<boolean> {
  const summaryPath = path.join(root, ".spec-lite", "feature-summary.md");
  if (!(await fs.pathExists(summaryPath))) return false;

  let content = await fs.readFile(summaryPath, "utf-8");
  let changed = false;

  for (const move of moves) {
    // Source spec: [feature_<name>.md](.spec-lite/features/feature_<name>.md)
    const { oldForms, newForm } = linkForms(move);
    for (const oldForm of oldForms) {
      if (content.includes(oldForm)) {
        content = content.split(oldForm).join(newForm);
        changed = true;
      }
    }
  }

  if (changed) await fs.writeFile(summaryPath, content, "utf-8");
  return changed;
}

/** Execute a previously planned migration: move files, then rewrite the two link sites. */
export async function runFeatureMigration(root: string, moves: PlannedMove[]): Promise<MigrationResult> {
  if (moves.length === 0) return { moved: [], planFilesRewritten: [], featureSummaryRewritten: false };

  const useGit = await isGitRepo(root);

  for (const move of moves) {
    const fromAbs = path.join(root, move.from);
    const toAbs = path.join(root, move.to);
    await fs.ensureDir(path.dirname(toAbs));

    if (useGit) {
      try {
        await execFileAsync("git", ["mv", move.from, move.to], { cwd: root });
        continue;
      } catch {
        // Not tracked, or some other git mv failure — fall through to a plain move.
      }
    }
    await fs.move(fromAbs, toAbs, { overwrite: false });
  }

  const planFilesRewritten = await rewritePlanSpecFileCells(root, moves);
  const featureSummaryRewritten = await rewriteFeatureSummaryLinks(root, moves);

  return { moved: moves, planFilesRewritten, featureSummaryRewritten };
}
