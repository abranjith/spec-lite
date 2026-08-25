/**
 * Optional, unregistered builtin: capture the changeset from `gh pr diff`
 * instead of a local git baseline. For PR-first teams where the working
 * feature branch already fully represents the change. Not in BUILTIN_HOOKS —
 * a user opts in by adding an entry for it in .spec-lite/hooks.json:
 *
 *   { "name": "changeset-from-pr", "events": ["implement.post"],
 *     "type": "builtin", "builtin": "changeset-from-pr" }
 */
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import { changesetPath } from "../workspace.js";
import type { ChangesetDoc } from "../changeset.js";

const execFileAsync = promisify(execFile);

export async function changesetFromPr(
  root: string,
  featureDir: string,
  opts: { event: string; role: string }
): Promise<ChangesetDoc> {
  const file = changesetPath(root, featureDir);
  const doc: ChangesetDoc = (await fs.pathExists(file))
    ? await fs.readJson(file)
    : { vcs: "git", captures: [], files: [], excluded: [] };

  const { stdout } = await execFileAsync("gh", ["pr", "diff", "--name-only"], { cwd: root });
  const paths = stdout.split("\n").map((l) => l.trim()).filter(Boolean);

  const byPath = new Map(doc.files.map((f) => [f.path, f]));
  for (const p of paths) {
    const existing = byPath.get(p);
    byPath.set(p, { path: p, status: existing?.status ?? "M", role: existing?.role ?? opts.role });
  }
  doc.files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  doc.captures.push({ event: opts.event, at: new Date().toISOString() });

  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, doc, { spaces: 2 });
  return doc;
}
