/** Git workflow state lives in the common Git directory, outside the commit scope. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs-extra";
import type { BuiltinContext, BuiltinOutcome } from "./index.js";
import type { WorktreeInfo } from "../types.js";

const execFileAsync = promisify(execFile);
const programEnvironment = new AsyncLocalStorage<NodeJS.ProcessEnv>();
export const withProgramEnvironment = <T>(env: NodeJS.ProcessEnv, action: () => Promise<T>): Promise<T> => programEnvironment.run(env, action);
export const GIT_WORKFLOW_HOOKS = ["prepare-worktree", "commit-progress", "create-pull-request"] as const;

export async function runProgram(
  root: string, executable: string, args: string[], timeout = 30000, env?: NodeJS.ProcessEnv
): Promise<string> {
  // Azure CLI is an az.cmd shim on Windows. PowerShell also handles custom
  // .cmd adapters without interpolating payload data into executable code.
  const usePowerShell = process.platform === "win32" && (executable === "az" || /\.(cmd|bat)$/i.test(executable));
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const bin = usePowerShell ? "powershell.exe" : executable;
  const argv = usePowerShell
    ? ["-NoProfile", "-NonInteractive", "-Command", `& ${[executable, ...args].map(quote).join(" ")}; exit $LASTEXITCODE`]
    : args;
  try {
    const { stdout } = await execFileAsync(bin, argv, {
      cwd: root, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...programEnvironment.getStore(), ...env },
    });
    return stdout.trim();
  } catch (err) {
    const error = err as { stderr?: string; message: string };
    throw new Error(`${executable} failed: ${error.stderr?.trim() || error.message}`);
  }
}

export const git = (root: string, args: string[], timeout?: number) => runProgram(root, "git", args, timeout);

export interface WorkflowState extends WorktreeInfo {
  identity: string;
  initialHead: string;
  ready?: boolean;
}

export async function repository(root: string): Promise<{ mainRoot: string; commonDir: string; entries: WorktreeEntry[] }> {
  const commonDir = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const raw = await git(root, ["worktree", "list", "--porcelain", "-z"]);
  const entries: WorktreeEntry[] = [];
  for (const block of raw.split("\0\0").filter(Boolean)) {
    const fields = block.split("\0");
    const location = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (location) entries.push({ path: path.resolve(location), branch: fields.find((field) => field.startsWith("branch "))?.slice(7) });
  }
  const mainRoot = entries[0]?.path;
  if (!mainRoot || entries[0]?.branch === undefined) throw new Error("A non-bare main checkout with a branch is required.");
  return { mainRoot, commonDir, entries };
}

interface WorktreeEntry { path: string; branch?: string }

export function workflowSlug(input: string): string {
  const slug = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Supply a work name containing letters or digits with --payload name=auth-issue.");
  return slug.length <= 60 ? slug : `${slug.slice(0, 51).replace(/-+$/, "")}-${crypto.createHash("sha256").update(slug).digest("hex").slice(0, 8)}`;
}

function workIdentity(ctx: BuiltinContext): { slug: string; identity: string; branch: string } {
  const feature = ctx.payload.feature;
  const explicitName = typeof ctx.payload.name === "string" ? ctx.payload.name : undefined;
  const name = explicitName ?? feature?.name;
  const isFix = ctx.payload.role === "fix";
  const raw = isFix && explicitName ? explicitName : feature?.id ? `${feature.id}-${name ?? "work"}` : name;
  if (!raw) throw new Error("prepare-worktree requires --feature or --payload name=auth-issue.");
  const slug = workflowSlug(`${isFix ? "fix-" : ""}${raw}`);
  return { slug, identity: `${ctx.payload.role}:${feature?.id ?? ""}:${workflowSlug(raw)}`, branch: `${isFix ? "fix" : "ft"}/${isFix ? slug.slice(4) : slug}` };
}

const stateFile = (commonDir: string, slug: string) => path.join(commonDir, "spec-lite", "worktrees", `${slug}.json`);

/** A shared Git-directory lock serializes retries, including remote PR creation. */
export async function withWorkflowLock<T>(commonDir: string, key: string, action: () => Promise<T>): Promise<T> {
  const file = path.join(commonDir, "spec-lite", "locks", `${crypto.createHash("sha256").update(key).digest("hex")}.lock`);
  await fs.ensureDir(path.dirname(file));
  let handle;
  try { handle = await fs.open(file, "wx"); }
  catch { throw new Error(`Another hook is using this workflow. Retry after it finishes. If interrupted, remove the stale lock: ${file}`); }
  try { return await action(); }
  finally { await fs.close(handle); await fs.remove(file); }
}

async function ignoreWorktrees(root: string): Promise<void> {
  const file = path.join(root, ".gitignore");
  const content = await fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
    return "";
  });
  if (content.split(/\r?\n/).includes("/.worktrees/")) return;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  await fs.writeFile(file, content + (content && !content.endsWith("\n") ? newline : "") + `/.worktrees/${newline}`);
}

export async function managedWorktree(root: string): Promise<{ state: WorkflowState; commonDir: string }> {
  const repo = await repository(root);
  const top = path.resolve(await git(root, ["rev-parse", "--show-toplevel"]));
  const relative = path.relative(path.join(repo.mainRoot, ".worktrees"), top);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(relative)) throw new Error("Run this hook inside a worktree created by prepare-worktree.");
  const state = await fs.readJson(stateFile(repo.commonDir, relative)).catch(() => undefined) as WorkflowState | undefined;
  const branch = await git(top, ["symbolic-ref", "--short", "HEAD"]);
  if (!state?.ready || path.resolve(state.path) !== top || path.resolve(state.mainRoot) !== repo.mainRoot || state.branch !== branch) {
    throw new Error("Worktree state does not match this checkout and branch; refusing to stage, push, or create a PR.");
  }
  return { state, commonDir: repo.commonDir };
}

export async function prepareWorktree(ctx: BuiltinContext): Promise<BuiltinOutcome> {
  const repo = await repository(ctx.root);
  const top = path.resolve(await git(ctx.root, ["rev-parse", "--show-toplevel"]));
  if (top !== repo.mainRoot && path.dirname(top) === path.join(repo.mainRoot, ".worktrees")) {
    const { state } = await managedWorktree(top);
    if (ctx.payload.feature?.id && !state.identity.includes(`:${ctx.payload.feature.id}:`)) throw new Error("This worktree belongs to another feature.");
    return { message: `Using ${state.branch} in ${state.path}`, worktree: state };
  }
  const work = workIdentity(ctx);
  const directory = path.join(repo.mainRoot, ".worktrees");
  if (await fs.pathExists(directory) && (await fs.lstat(directory)).isSymbolicLink()) throw new Error("The .worktrees directory must not be a symlink or junction.");
  const destination = path.join(directory, work.slug);
  return withWorkflowLock(repo.commonDir, destination, async () => {
    const file = stateFile(repo.commonDir, work.slug);
    const previous = await fs.readJson(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
      return undefined;
    }) as WorkflowState | undefined;
    const existing = repo.entries.find((entry) => entry.path === destination);
    if (previous && previous.identity !== work.identity) throw new Error("Worktree name collision; use a different work name.");
    if (previous && (path.resolve(previous.path) !== destination || path.resolve(previous.mainRoot) !== repo.mainRoot || previous.branch !== work.branch)) throw new Error("Stored worktree state does not match the expected repository, path, and branch.");
    if (existing && existing.branch !== `refs/heads/${work.branch}`) throw new Error("Worktree path is occupied by another branch.");
    if (!existing && await fs.pathExists(destination)) throw new Error(`Worktree path is already occupied: ${destination}`);
    if (existing && previous?.ready) {
      await ignoreWorktrees(repo.mainRoot);
      await ignoreWorktrees(destination);
      return { message: `Resumed ${previous.branch} from ${previous.fromBranch} in ${destination}`, worktree: previous };
    }
    if (existing && !previous) throw new Error("This worktree is not owned by prepare-worktree; choose another name.");
    const configured = ctx.hook?.options?.fromBranch;
    const fromBranch = configured ?? previous?.fromBranch ?? await git(repo.mainRoot, ["symbolic-ref", "--short", "HEAD"]);
    await git(repo.mainRoot, ["check-ref-format", "--branch", fromBranch]);
    let start = previous?.initialHead;
    if (!start) {
      try { start = await git(repo.mainRoot, ["rev-parse", "--verify", `refs/heads/${fromBranch}^{commit}`]); }
      catch { start = await git(repo.mainRoot, ["rev-parse", "--verify", `refs/remotes/${fromBranch}^{commit}`]); }
    }
    const branchExists = (await git(repo.mainRoot, ["branch", "--list", work.branch])).length > 0;
    if (branchExists && !previous) throw new Error(`Branch ${work.branch} already exists outside this workflow; choose another name.`);
    await ignoreWorktrees(repo.mainRoot);
    const state: WorkflowState = previous ?? { mainRoot: repo.mainRoot, path: destination, branch: work.branch, fromBranch, identity: work.identity, initialHead: start };
    // Record ownership before creation, allowing retries after an interrupted add.
    await fs.outputJson(file, state, { spaces: 2 });
    if (!existing) {
      await fs.ensureDir(path.dirname(destination));
      await git(repo.mainRoot, branchExists
        ? ["worktree", "add", destination, work.branch]
        : ["worktree", "add", "-b", work.branch, destination, start]);
    }
    if (!existing || !previous?.ready) {
      // Copy workflow inputs, including uncommitted specs/configuration. Source
      // code and unrelated dirt stay in the caller's checkout. Never overwrite
      // edits on a resumed worktree.
      for (const item of [".spec-lite", ".spec-lite.json"]) {
        const source = path.join(ctx.root, item);
        if (await fs.pathExists(source)) await fs.copy(source, path.join(destination, item), {
          filter: (sourcePath) => !["changeset.json", "hooks.log.jsonl"].includes(path.basename(sourcePath)),
        });
      }
    }
    await ignoreWorktrees(destination);
    state.ready = true;
    await fs.outputJson(file, state, { spaces: 2 });
    return { message: `${existing ? "Resumed" : "Prepared"} ${work.branch} from ${state.fromBranch} in ${destination}`, worktree: state };
  });
}

export async function commitProgress(ctx: BuiltinContext): Promise<BuiltinOutcome> {
  const { state, commonDir } = await managedWorktree(ctx.root);
  return withWorkflowLock(commonDir, state.path, async () => {
    // Runtime capture/log timestamps must not create commits on an unchanged retry.
    const stagedRuntime = await git(state.path, ["diff", "--cached", "--name-only", "--", ".spec-lite/**/changeset.json", ".spec-lite/**/hooks.log.jsonl"]);
    if (stagedRuntime) throw new Error("Unstage hook runtime changeset/log files before committing progress.");
    await git(state.path, ["add", "--all", "--", ".", ":(exclude).spec-lite/**/changeset.json", ":(exclude).spec-lite/**/hooks.log.jsonl"]);
    const staged = await git(state.path, ["diff", "--cached", "--name-only"]);
    let message = "No changes to commit";
    if (staged) {
      const summary = (ctx.payload.summary ?? "Code changes").replace(/[\r\n]+/g, " ").trim().slice(0, 160);
      const title = `${ctx.payload.feature?.id ?? state.branch}${ctx.payload.task?.id ? ` ${ctx.payload.task.id}` : ""}: ${summary}`;
      await git(state.path, ["commit", "-m", title], ctx.hook?.timeoutMs);
      message = `Committed ${await git(state.path, ["rev-parse", "--short", "HEAD"])}`;
    }
    if (ctx.payload.event === "implement.post" || ctx.payload.event === "fix.post") {
      const remote = ctx.hook?.options?.remote ?? "origin";
      await git(state.path, ["remote", "get-url", remote]);
      await git(state.path, ["push", "--set-upstream", remote, `HEAD:refs/heads/${state.branch}`], ctx.hook?.timeoutMs ?? 120000);
      message += `; pushed ${state.branch} to ${remote}`;
    }
    return { message };
  });
}
