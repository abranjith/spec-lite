/**
 * Git-backed changeset capture.
 *
 * Two phases, matched to the `*.pre` / `*.post` events:
 *
 *  - `captureBaseline` (pre) records HEAD and whatever is already dirty, so
 *    pre-existing edits are never attributed to the feature or fix being
 *    worked on.
 *  - `captureChangeset` (post) unions committed history since the baseline,
 *    the current working-tree diff, and new untracked files, subtracts the
 *    baseline's pre-existing dirt, and merges the result into changeset.json.
 *
 * This is intentionally a *baseline-anchored diff*, not raw git history —
 * `skills/review/SKILL.md` forbids inferring scope from git history, and that
 * prohibition is correct (history is not the same thing as "what this feature
 * touched"). A diff pinned to a baseline captured at `*.pre` is scoped to
 * exactly the work done since, which is what a hand-maintained Touched Files
 * list was trying and failing to be.
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import { changesetPath } from "./workspace.js";
import type { ChangedFile } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_EXCLUDES = [
  /^dist\//, /^build\//, /^out\//, /^node_modules\//,
  /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
  /^\.spec-lite\//,
];

async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; code?: number };
    if (typeof e.stdout === "string") return e.stdout;
    throw err;
  }
}

async function isGitRepo(root: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/** Working-tree blob hash for a path, or undefined if it doesn't exist (deleted). */
async function hashWorkingTreeFile(root: string, relPath: string): Promise<string | undefined> {
  try {
    const out = await execFileAsync("git", ["hash-object", "--", relPath], { cwd: root });
    return out.stdout.trim();
  } catch {
    return undefined; // file does not exist right now
  }
}

export interface ChangesetFile {
  path: string;
  status: ChangedFile["status"];
  role?: string;
  task?: string;
}

export interface ChangesetDoc {
  featureId?: string;
  vcs: "git" | "none";
  baseline?: {
    sha: string;
    capturedAt: string;
    dirtyAtBaseline: string[];
    /**
     * Working-tree blob hash of each dirtyAtBaseline path at capture time.
     * A path missing from this map (or hashing to undefined) was absent from
     * the working tree at baseline. Used to tell "still exactly as dirty as
     * it was before this run started" (exclude) apart from "was already
     * dirty, and got edited further during this run" (include) — see
     * captureChangeset. Without this distinction, a file that was mid-edit
     * before `implement` started would have every subsequent edit to it
     * silently dropped from the changeset for the rest of the run.
     */
    dirtyBlobHashes: Record<string, string | null>;
  };
  captures: Array<{ event: string; task?: string; at: string; head?: string }>;
  files: ChangesetFile[];
  excluded: string[];
  /** Why no diff was possible, when capture ran without a usable baseline. */
  noBaselineReason?: string;
}

function isExcluded(p: string): boolean {
  return DEFAULT_EXCLUDES.some((re) => re.test(p));
}

async function readDoc(file: string): Promise<ChangesetDoc> {
  if (await fs.pathExists(file)) {
    return (await fs.readJson(file)) as ChangesetDoc;
  }
  return { vcs: "none", captures: [], files: [], excluded: [] };
}

/**
 * `git status --porcelain=v1 -z --untracked-files=all` parsed into
 * workspace-relative paths, XY status stripped.
 *
 * `--untracked-files=all` matters: without it, git collapses a whole
 * untracked directory into one entry ending in "/" (e.g. a brand-new
 * `src/newmodule/` becomes the single path "src/newmodule/" rather than its
 * individual files). Left uncollapsed, that path would never equal any real
 * file path later, silently defeating the dirty-at-baseline exclusion for
 * every file inside it.
 */
async function porcelainPaths(root: string): Promise<string[]> {
  const raw = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = raw.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (const entry of entries) {
    // "XY path" or, for renames, "XY orig\0new" — the second half already
    // appears as its own -z record, so only the first token needs slicing.
    const p = entry.slice(3);
    if (p) paths.push(p);
  }
  return paths;
}

/**
 * Record HEAD and the set of files already dirty, before any work begins.
 * Called at `implement.pre`, `implement.task.pre`, `fix.pre`.
 */
export async function captureBaseline(
  root: string,
  featureDir: string,
  opts: { featureId?: string; event: string }
): Promise<ChangesetDoc> {
  const file = changesetPath(root, featureDir);
  const doc = await readDoc(file);

  if (!(await isGitRepo(root))) {
    doc.vcs = "none";
    await fs.ensureDir(path.dirname(file));
    await fs.writeJson(file, doc, { spaces: 2 });
    return doc;
  }

  // Only the first *.pre in a feature's lifetime sets the baseline — a later
  // implement.task.pre must not reset it, or task 2's baseline would exclude
  // task 1's own changes.
  if (!doc.baseline) {
    const sha = (await git(root, ["rev-parse", "HEAD"])).trim();
    const dirty = await porcelainPaths(root);
    const dirtyBlobHashes: Record<string, string | null> = {};
    for (const p of dirty) {
      dirtyBlobHashes[p] = (await hashWorkingTreeFile(root, p)) ?? null;
    }
    doc.vcs = "git";
    doc.baseline = { sha, capturedAt: new Date().toISOString(), dirtyAtBaseline: dirty, dirtyBlobHashes };
  }
  if (opts.featureId) doc.featureId = opts.featureId;

  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, doc, { spaces: 2 });
  return doc;
}

function parseNameStatus(raw: string): Array<{ path: string; status: ChangedFile["status"] }> {
  const out: Array<{ path: string; status: ChangedFile["status"] }> = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [code, ...rest] = line.split("\t");
    const p = rest[rest.length - 1];
    if (!p) continue;
    const status = code[0] === "R" ? "R" : code[0] === "A" ? "A" : code[0] === "D" ? "D" : "M";
    out.push({ path: p, status });
  }
  return out;
}

/**
 * Diff the working tree (and any commits made) against the recorded baseline,
 * merge the result into changeset.json. Called at `implement.post`,
 * `implement.task.post`, `fix.post`.
 */
export async function captureChangeset(
  root: string,
  featureDir: string,
  opts: { event: string; role: string; task?: string }
): Promise<ChangesetDoc> {
  const file = changesetPath(root, featureDir);
  const doc = await readDoc(file);

  if (doc.vcs !== "git" || !doc.baseline) {
    // Nothing to diff against. Distinguish the two causes: "not a git repo"
    // and "*.pre never ran" need completely different fixes, and reporting
    // the wrong one sends the user debugging a problem they do not have.
    doc.noBaselineReason = (await isGitRepo(root))
      ? "no baseline recorded — the matching *.pre event did not run for this feature"
      : "not a git repository";
    doc.captures.push({ event: opts.event, task: opts.task, at: new Date().toISOString() });
    await fs.ensureDir(path.dirname(file));
    await fs.writeJson(file, doc, { spaces: 2 });
    return doc;
  }

  const baselineSha = doc.baseline.sha;
  const dirtyAtBaseline = new Set(doc.baseline.dirtyAtBaseline);

  const [committed, workingTree, untracked, head] = await Promise.all([
    git(root, ["diff", "--name-status", baselineSha, "HEAD"]),
    git(root, ["diff", "--name-status", baselineSha]),
    git(root, ["ls-files", "--others", "--exclude-standard"]),
    git(root, ["rev-parse", "HEAD"]),
  ]);

  const found = new Map<string, ChangedFile["status"]>();
  for (const { path: p, status } of parseNameStatus(committed)) found.set(p, status);
  for (const { path: p, status } of parseNameStatus(workingTree)) found.set(p, status);
  for (const p of untracked.split("\n").filter(Boolean)) {
    if (!found.has(p)) found.set(p, "U");
  }

  const excluded: string[] = [];
  const byPath = new Map(doc.files.map((f) => [f.path, f]));

  for (const [p, status] of found) {
    if (dirtyAtBaseline.has(p)) {
      // Was already dirty before this run started. Only exclude it if it is
      // STILL exactly as it was at baseline — if it changed further during
      // this run, that further change is genuinely this run's work and must
      // be included. A blunt "was dirty at baseline -> always exclude" would
      // silently drop every subsequent edit to a file the user happened to
      // have mid-edit before starting.
      const baselineHash = doc.baseline.dirtyBlobHashes[p] ?? null;
      const currentHash = (await hashWorkingTreeFile(root, p)) ?? null;
      if (baselineHash === currentHash) continue; // unchanged since baseline
    }
    if (isExcluded(p)) {
      excluded.push(p);
      continue;
    }
    const existing = byPath.get(p);
    byPath.set(p, {
      path: p,
      status,
      role: existing?.role ?? opts.role,
      task: existing?.task ?? opts.task,
    });
  }

  doc.files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  doc.excluded = [...new Set([...doc.excluded, ...excluded])].sort();
  doc.captures.push({ event: opts.event, task: opts.task, at: new Date().toISOString(), head: head.trim() });

  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, doc, { spaces: 2 });
  return doc;
}

export async function readChangeset(root: string, featureDir: string): Promise<ChangesetDoc | undefined> {
  const file = changesetPath(root, featureDir);
  if (!(await fs.pathExists(file))) return undefined;
  return (await fs.readJson(file)) as ChangesetDoc;
}
