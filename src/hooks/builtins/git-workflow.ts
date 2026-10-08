/**
 * Git workflow builtins: one managed worktree per unit of work, a commit per
 * verified task, and a push at completion. Workflow state lives in the common
 * Git directory (`.git/spec-lite/`), outside every commit.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs-extra";
import type { BuiltinContext, BuiltinOutcome } from "./index.js";
import type { GitWorkflowConfig, HookPayload, WorkflowKind, WorktreeInfo } from "../types.js";
import { readProjectConfig, resolveFeature } from "../workspace.js";
import { COMMIT_TEMPLATE_RE } from "./git-config.js";

const execFileAsync = promisify(execFile);
const programEnvironment = new AsyncLocalStorage<NodeJS.ProcessEnv>();
export const withProgramEnvironment = <T>(env: NodeJS.ProcessEnv, action: () => Promise<T>): Promise<T> => programEnvironment.run(env, action);
export const GIT_WORKFLOW_HOOKS = ["prepare-worktree", "commit-progress", "create-pull-request"] as const;
/** Hook logs are local audit trails: excluded in every clone that writes one, never committed. */
export const HOOK_LOG_PATTERN = ".spec-lite/**/hooks.log.jsonl";
const COMPLETION_EVENTS = ["implement.post", "fix.post"];
const RUNTIME_FILES = ["changeset.json", "hooks.log.jsonl"];
const FEATURE_ID = /\bFEAT-(?:FP-)?\d+\b/gi;

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * Azure CLI on Windows is an `az.cmd` shim, and cmd.exe re-parses its command
 * line: quotes and `&` in a PR title become commands, and `%VAR%` expands.
 * Run the Python interpreter the shim itself launches, so PR text never
 * reaches cmd.exe.
 */
export function azureCliInvocation(env: NodeJS.ProcessEnv): { bin: string; args: string[] } {
  for (const dir of (envValue(env, "PATH") ?? "").split(path.delimiter).filter(Boolean)) {
    const shim = ["az.cmd", "az.bat"].map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));
    if (!shim) continue;
    const bundled = path.resolve(dir, "..", "python.exe");
    if (fs.existsSync(bundled)) return { bin: bundled, args: ["-IBm", "azure.cli"] };
    const local = path.join(dir, "python.exe");
    if (fs.existsSync(local)) return { bin: local, args: ["-m", "azure.cli"] };
    throw new Error(`Found ${shim}, but not the Python runtime it launches; pull request text is never passed through cmd.exe.`);
  }
  throw new Error("Azure CLI (az) was not found on PATH.");
}

/** How to start a program with no shell between spec-lite and its arguments. */
export function programInvocation(executable: string, args: string[], env: NodeJS.ProcessEnv): { bin: string; argv: string[] } {
  if (process.platform !== "win32") return { bin: executable, argv: args };
  if (executable === "az") {
    const azure = azureCliInvocation(env);
    return { bin: azure.bin, argv: [...azure.args, ...args] };
  }
  // A custom .cmd/.bat adapter cannot run without cmd.exe. Its arguments are
  // literal registry configuration; payload data reaches it only through
  // SPEC_LITE_PR_* variables and the body file, never this command line.
  if (/\.(cmd|bat)$/i.test(executable)) {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    return { bin: "powershell.exe", argv: ["-NoProfile", "-NonInteractive", "-Command", `& ${[executable, ...args].map(quote).join(" ")}; exit $LASTEXITCODE`] };
  }
  return { bin: executable, argv: args };
}

export async function runProgram(
  root: string, executable: string, args: string[], timeout = 30000, env?: NodeJS.ProcessEnv
): Promise<string> {
  const merged = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...programEnvironment.getStore(), ...env };
  const { bin, argv } = programInvocation(executable, args, merged);
  try {
    const { stdout } = await execFileAsync(bin, argv, { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: merged });
    return stdout.trim();
  } catch (err) {
    const error = err as { stderr?: string; message: string };
    throw new Error(`${executable} failed: ${error.stderr?.trim() || error.message}`);
  }
}

export const git = (root: string, args: string[], timeout?: number) => runProgram(root, "git", args, timeout);
const succeeds = (action: Promise<unknown>) => action.then(() => true, () => false);

/**
 * Paths from `git status --porcelain -z`. Read untrimmed: the first entry's
 * status column may begin with a space, and trimming would shift its path.
 */
async function statusEntries(root: string, args: string[] = []): Promise<Array<{ code: string; path: string }>> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-z", "--untracked-files=all", ...args], {
    cwd: root, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const entries: Array<{ code: string; path: string }> = [];
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4) continue;
    entries.push({ code: record.slice(0, 2), path: record.slice(3) });
    if (/[RC]/.test(record[0])) i++; // a rename's next record is its original path
  }
  return entries;
}

export interface WorkflowState extends WorktreeInfo {
  kind: WorkflowKind;
  /** Directory name under the worktree root; also names the state file. */
  name: string;
  feature?: string;
  plan?: string;
  ready?: boolean;
  /** Checkout the inputs were copied from, and which of them were uncommitted there. */
  source?: string;
  copied?: Array<{ path: string; hash: string }>;
}

interface WorktreeEntry { path: string; branch?: string; bare: boolean }
export interface Repository { mainRoot: string; commonDir: string; mainBranch?: string; entries: WorktreeEntry[] }

let gitVersionChecked = false;
async function requireGitVersion(root: string): Promise<void> {
  if (gitVersionChecked) return;
  const version = await git(root, ["--version"]);
  const [major, minor] = (/(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number);
  if (major < 2 || (major === 2 && minor < 36)) throw new Error(`The Git workflow hooks need Git 2.36 or newer (found "${version}").`);
  gitVersionChecked = true;
}

export async function repository(root: string): Promise<Repository> {
  await requireGitVersion(root);
  const commonDir = path.resolve(await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const raw = await git(root, ["worktree", "list", "--porcelain", "-z"]);
  const entries: WorktreeEntry[] = [];
  for (const block of raw.split("\0\0").filter(Boolean)) {
    const fields = block.split("\0");
    const location = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (location) entries.push({ path: path.resolve(location), branch: fields.find((field) => field.startsWith("branch "))?.slice(7), bare: fields.includes("bare") });
  }
  const main = entries[0];
  if (!main || main.bare) throw new Error("The Git workflow hooks need a non-bare main checkout.");
  return { mainRoot: main.path, commonDir, mainBranch: main.branch?.replace(/^refs\/heads\//, ""), entries };
}

export async function gitWorkflowConfig(root: string): Promise<GitWorkflowConfig> {
  return (await readProjectConfig(root)).gitWorkflow ?? {};
}

export const worktreesDirectory = (mainRoot: string, config: GitWorkflowConfig): string =>
  path.resolve(mainRoot, config.worktreeRoot ?? ".worktrees");

export function workflowSlug(input: string): string {
  const slug = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Supply a work name containing letters or digits with --payload name=auth-issue.");
  return slug.length <= 60 ? slug : `${slug.slice(0, 51).replace(/-+$/, "")}-${crypto.createHash("sha256").update(slug).digest("hex").slice(0, 8)}`;
}

export interface WorkItem {
  kind: WorkflowKind;
  name: string;
  identity: string;
  branch: string;
  feature?: string;
  plan?: string;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function scoped(kind: WorkflowKind, raw: string): Pick<WorkItem, "kind" | "name" | "identity" | "branch"> {
  let base = workflowSlug(raw);
  if (base.startsWith(`${kind}-`) && base.length > kind.length + 1) base = base.slice(kind.length + 1);
  const name = workflowSlug(`${kind}-${base}`);
  const label = name.slice(kind.length + 1);
  return { kind, name, identity: `${kind}:${label}`, branch: `${kind}/${label}` };
}

/** True when the payload names a unit of work at all. */
export const identifiesWork = (payload: HookPayload): boolean =>
  !!(text(payload.yolo) || text(payload.plan) || text(payload.name) || payload.feature?.id);

/**
 * The unit of work an invocation names. Branches and directories derive only
 * from stable identifiers — a feature directory, a plan file, a review report
 * scope, a recorded YOLO run ID — or from the name a Fix passes.
 */
export function workItem(payload: HookPayload): WorkItem {
  const yolo = text(payload.yolo);
  if (yolo) return scoped("yolo", yolo);
  const plan = text(payload.plan);
  if (plan) {
    const file = plan.replace(/\\/g, "/").replace(/^\.\//, "");
    const label = path.posix.basename(file).replace(/\.md$/i, "").replace(/^plan(?:[_-]|$)/i, "") || "default";
    return { ...scoped("plan", label), plan: file };
  }
  const feature = payload.feature;
  if (feature?.id && !feature.dir) throw new Error(`Feature ${feature.id} was not found under .spec-lite/features; check the ID before starting a workflow.`);
  const name = text(payload.name);
  if (payload.role === "fix") {
    const raw = name ?? (feature?.dir ? `${feature.id}-${feature.name}` : undefined);
    if (!raw) throw new Error("Name the fix with --payload name=<issue>, using a ticket ID when there is one.");
    return { ...scoped("fix", raw), feature: feature?.id };
  }
  if (name) return { ...scoped("review", name), feature: feature?.id };
  if (feature?.id) {
    const slug = workflowSlug(`${feature.id}-${feature.name ?? ""}`);
    return { kind: "feature", name: slug, identity: `feature:${feature.id}`, branch: `ft/${slug}`, feature: feature.id };
  }
  throw new Error("Identify the work with --feature, --payload name=…, --payload plan=…, or --payload yolo=….");
}

const stateDirectory = (commonDir: string) => path.join(commonDir, "spec-lite", "worktrees");
export const stateFile = (commonDir: string, name: string) => path.join(stateDirectory(commonDir), `${name}.json`);

export async function readState(commonDir: string, name: string): Promise<WorkflowState | undefined> {
  return fs.readJson(stateFile(commonDir, name)).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined;
    throw err;
  }) as Promise<WorkflowState | undefined>;
}

export async function listStates(commonDir: string): Promise<WorkflowState[]> {
  const files = (await fs.readdir(stateDirectory(commonDir)).catch(() => [] as string[])).filter((file) => file.endsWith(".json")).sort();
  const states = await Promise.all(files.map((file) => readState(commonDir, file.slice(0, -5))));
  return states.filter((state): state is WorkflowState => !!state);
}

/** Active until cleanup: ready, with its worktree still registered on its branch. */
export const isActive = (state: WorkflowState, repo: Repository): boolean =>
  !!state.ready && repo.entries.some((entry) => entry.path === path.resolve(state.path) && entry.branch === `refs/heads/${state.branch}`);

const handoff = (state: WorkflowState): WorktreeInfo => ({
  mainRoot: state.mainRoot, path: state.path, branch: state.branch, fromBranch: state.fromBranch,
  identity: state.identity, initialHead: state.initialHead,
});

async function featuresIn(root: string, files: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const file of files) {
    const content = await fs.readFile(path.join(root, file), "utf8").catch(() => "");
    for (const match of content.matchAll(FEATURE_ID)) ids.add(match[0].toUpperCase());
  }
  return ids;
}

const planFiles = async (root: string): Promise<string[]> =>
  (await fs.readdir(path.join(root, ".spec-lite")).catch(() => [] as string[]))
    .filter((file) => /^plan.*\.md$/i.test(file)).sort().map((file) => `.spec-lite/${file}`);

/** A feature belongs to its own workflow, or to a plan/YOLO workflow whose plans list it. */
async function activeOwners(repo: Repository, feature: string): Promise<WorkflowState[]> {
  const owners: WorkflowState[] = [];
  for (const state of await listStates(repo.commonDir)) {
    if (!isActive(state, repo)) continue;
    if (state.kind === "feature" && state.feature === feature) owners.push(state);
    if (state.kind === "plan" || state.kind === "yolo") {
      const plans = state.kind === "plan" && state.plan ? [state.plan] : await planFiles(state.path);
      if ((await featuresIn(state.path, plans)).has(feature)) owners.push(state);
    }
  }
  return owners;
}

/** Why an invocation cannot continue in the worktree it is already inside, if it cannot. */
function incompatibility(state: WorkflowState, work: WorkItem | undefined, feature: string | undefined): string | undefined {
  if (work?.identity === state.identity) return undefined;
  if (work && (work.kind === "plan" || work.kind === "yolo")) return `this worktree belongs to ${state.identity}, not ${work.identity}`;
  if (state.kind === "plan" || state.kind === "yolo") return undefined;
  if (feature && state.feature !== feature) return `this worktree belongs to ${state.identity}, not ${feature}`;
  return undefined;
}

/** A shared Git-directory lock serializes retries, including remote PR creation. */
export async function withWorkflowLock<T>(commonDir: string, key: string, action: () => Promise<T>): Promise<T> {
  const file = path.join(commonDir, "spec-lite", "locks", `${crypto.createHash("sha256").update(key).digest("hex")}.lock`);
  await fs.ensureDir(path.dirname(file));
  await acquireLock(file);
  try { return await action(); }
  finally { await fs.remove(file); }
}

const processAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
};

async function acquireLock(file: string): Promise<void> {
  const owner = JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() });
  for (let attempt = 0; ; attempt++) {
    try { await fs.writeFile(file, owner, { flag: "wx" }); return; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = await fs.readJson(file).catch(() => undefined) as { pid?: number; host?: string } | undefined;
      // A process killed mid-hook (an agent's tool timeout, Ctrl-C) never
      // releases its lock. Take it over once that process is gone.
      if (attempt === 0 && holder?.host === os.hostname() && typeof holder.pid === "number" && !processAlive(holder.pid)) {
        await fs.remove(file);
        continue;
      }
      const by = typeof holder?.pid === "number" ? ` (process ${holder.pid} on ${holder.host})` : "";
      throw new Error(`Another spec-lite hook is using this workflow${by}. Retry after it finishes. If no spec-lite process is running, remove the stale lock: ${file}`);
    }
  }
}

/** Ignore a pattern in every checkout of the repository without editing a tracked file. */
export async function ensureExcluded(root: string, pattern: string): Promise<void> {
  const file = path.resolve(root, await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]));
  const content = await fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
    return "";
  });
  if (content.split(/\r?\n/).includes(pattern)) return;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  await fs.outputFile(file, content + (content && !content.endsWith("\n") ? newline : "") + pattern + newline);
}

const excludedRoots = new Set<string>();
/** Called before each hook log write; a no-op outside Git or once done for a root. */
export async function excludeHookLogs(root: string): Promise<void> {
  if (excludedRoots.has(root)) return;
  excludedRoots.add(root);
  await ensureExcluded(root, HOOK_LOG_PATTERN).catch(() => undefined);
}

async function excludeWorktrees(mainRoot: string, directory: string): Promise<void> {
  const relative = path.relative(mainRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return; // outside the checkout
  await ensureExcluded(mainRoot, `/${relative.split(path.sep).join("/")}/`);
}

export async function localBranchExists(root: string, branch: string): Promise<boolean> {
  return succeeds(git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]));
}

export async function managedWorktree(root: string, config: GitWorkflowConfig): Promise<{ state: WorkflowState; repo: Repository }> {
  const repo = await repository(root);
  const top = path.resolve(await git(root, ["rev-parse", "--show-toplevel"]));
  const name = path.relative(worktreesDirectory(repo.mainRoot, config), top);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Run this hook inside a worktree created by prepare-worktree.");
  const state = await readState(repo.commonDir, name).catch(() => undefined);
  const branch = await git(top, ["symbolic-ref", "--short", "HEAD"]).catch(() => undefined);
  if (!state?.ready || path.resolve(state.path) !== top || path.resolve(state.mainRoot) !== repo.mainRoot || state.branch !== branch) {
    throw new Error("Worktree state does not match this checkout and branch; refusing to stage, push, or create a PR.");
  }
  return { state, repo };
}

/** Workflow inputs only: the work's own specs and plans, never unrelated drafts in the calling checkout. */
async function inputPaths(source: string, work: WorkItem, payload: HookPayload): Promise<string[]> {
  const items = new Set([".spec-lite.json", ".spec-lite/hooks.json", ".spec-lite/memory.md", ".spec-lite/data_model.md", ".spec-lite/tools"]);
  const allPlans = await planFiles(source);
  const features = new Set<string>(payload.feature?.id ? [payload.feature.id] : []);
  const plans = work.kind === "plan" ? [work.plan!] : work.kind === "yolo" ? allPlans : [];
  if (work.kind === "yolo") for (const file of ["yolo_state.md", "brainstorm.md"]) items.add(`.spec-lite/${file}`);
  for (const plan of plans) items.add(plan);
  for (const id of await featuresIn(source, plans)) features.add(id);
  if (payload.feature?.id) {
    for (const plan of allPlans) if ((await featuresIn(source, [plan])).has(payload.feature.id)) items.add(plan);
  }
  for (const id of features) {
    const feature = await resolveFeature(source, id);
    if (feature) items.add(feature.dir);
  }
  const name = text(payload.name);
  if (name) for (const report of [`review_${name}.md`, `fix_${name}.md`]) items.add(`.spec-lite/reviews/${report}`);
  const existing: string[] = [];
  for (const item of items) if (await fs.pathExists(path.join(source, item))) existing.push(item);
  return existing;
}

/**
 * Copy the work's inputs, including uncommitted specs. Records which copies
 * were uncommitted in the source checkout, so cleanup can reset them there
 * once merged and a pull is not blocked by identical local edits.
 */
async function copyInputs(source: string, destination: string, work: WorkItem, payload: HookPayload): Promise<WorkflowState["copied"]> {
  const inputs = await inputPaths(source, work, payload);
  for (const item of inputs) {
    await fs.copy(path.join(source, item), path.join(destination, item), { filter: (file) => !RUNTIME_FILES.includes(path.basename(file)) });
  }
  if (!inputs.length) return [];
  const dirty = (await statusEntries(source, ["--", ...inputs]))
    .filter((entry) => !entry.code.includes("D") && !RUNTIME_FILES.includes(path.posix.basename(entry.path)));
  return Promise.all(dirty.map(async (entry) => ({ path: entry.path, hash: await git(source, ["hash-object", "--", entry.path]) })));
}

/** An interrupted `worktree add` can leave a partial checkout; never hand that out or commit its missing files as deletions. */
async function verifyInterruptedCheckout(destination: string): Promise<void> {
  const unexpected = (await statusEntries(destination)).map((entry) => entry.path)
    .filter((file) => file !== ".spec-lite.json" && !file.startsWith(".spec-lite/"));
  if (unexpected.length) {
    throw new Error(`The interrupted worktree at ${destination} has unexpected changes (${unexpected.slice(0, 5).join(", ")}). It never held work; remove it with \`git worktree remove --force "${destination}"\` and retry.`);
  }
}

async function newState(ctx: BuiltinContext, config: GitWorkflowConfig, repo: Repository, work: WorkItem, destination: string): Promise<WorkflowState> {
  const fromBranch = config.fromBranch ?? repo.mainBranch;
  if (!fromBranch) throw new Error("The main checkout has no branch checked out; set gitWorkflow.fromBranch in .spec-lite.json.");
  await git(repo.mainRoot, ["check-ref-format", "--branch", fromBranch]);
  let initialHead: string;
  if (config.fetch) {
    await git(repo.mainRoot, ["fetch", "--no-tags", config.remote ?? "origin", `refs/heads/${fromBranch}`], ctx.hook?.timeoutMs ?? 300000);
    initialHead = await git(repo.mainRoot, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  } else {
    try { initialHead = await git(repo.mainRoot, ["rev-parse", "--verify", `refs/heads/${fromBranch}^{commit}`]); }
    catch { initialHead = await git(repo.mainRoot, ["rev-parse", "--verify", `refs/remotes/${fromBranch}^{commit}`]); }
  }
  return {
    mainRoot: repo.mainRoot, path: destination, branch: work.branch, fromBranch, identity: work.identity, initialHead,
    kind: work.kind, name: work.name, feature: work.feature, plan: work.plan,
  };
}

async function createOrResume(ctx: BuiltinContext, config: GitWorkflowConfig, repo: Repository, work: WorkItem, source: string, destination: string): Promise<BuiltinOutcome> {
  let previous = await readState(repo.commonDir, work.name);
  if (previous && previous.identity !== work.identity) throw new Error(`Worktree name ${work.name} is already used by ${previous.identity}; use a different name.`);
  if (previous && (path.resolve(previous.path) !== destination || path.resolve(previous.mainRoot) !== repo.mainRoot || previous.branch !== work.branch)) {
    throw new Error("Stored worktree state does not match the expected repository, path, and branch.");
  }
  const existing = repo.entries.find((entry) => entry.path === destination);
  if (existing && existing.branch !== `refs/heads/${work.branch}`) throw new Error(`Worktree path ${destination} is checked out on another branch.`);
  if (!existing && await fs.pathExists(destination)) throw new Error(`Worktree path is already occupied: ${destination}`);
  if (existing && !previous) throw new Error("This worktree is not owned by prepare-worktree; choose another name.");
  await excludeWorktrees(repo.mainRoot, path.dirname(destination));
  if (existing && previous?.ready) return { message: `Resumed ${previous.branch} in ${destination}`, worktree: handoff(previous) };

  const branchExists = await localBranchExists(repo.mainRoot, work.branch);
  if (previous?.ready) {
    // Its worktree was removed: the workflow finished or was abandoned. Never
    // resume a stale branch or start a new one from its old base.
    if (branchExists) {
      throw new Error(`${work.identity} has no worktree, but branch ${work.branch} still exists. If it was merged, run \`spec-lite worktree cleanup ${work.name}\`; to resume it, run \`git worktree add "${destination}" ${work.branch}\`.`);
    }
    await fs.remove(stateFile(repo.commonDir, work.name));
    previous = undefined;
  }
  if (branchExists && !previous) throw new Error(`Branch ${work.branch} already exists outside this workflow; delete or rename it first.`);
  if (!previous && work.plan && !(await fs.pathExists(path.join(source, work.plan)))) throw new Error(`Plan file ${work.plan} was not found.`);

  const state = previous ?? await newState(ctx, config, repo, work, destination);
  // Record ownership before creation, so a retry can finish an interrupted add.
  await fs.outputJson(stateFile(repo.commonDir, work.name), state, { spaces: 2 });
  if (existing) await verifyInterruptedCheckout(destination);
  else {
    await fs.ensureDir(path.dirname(destination));
    await git(repo.mainRoot, branchExists
      ? ["worktree", "add", destination, work.branch]
      : ["worktree", "add", "-b", work.branch, destination, state.initialHead], ctx.hook?.timeoutMs ?? 300000);
  }
  state.source = source;
  state.copied = await copyInputs(source, destination, work, ctx.payload);
  state.ready = true;
  await fs.outputJson(stateFile(repo.commonDir, work.name), state, { spaces: 2 });
  return { message: `${existing ? "Resumed" : "Prepared"} ${work.branch} from ${state.fromBranch} in ${destination}`, worktree: handoff(state) };
}

export async function prepareWorktree(ctx: BuiltinContext): Promise<BuiltinOutcome> {
  const config = await gitWorkflowConfig(ctx.root);
  const repo = await repository(ctx.root);
  const directory = worktreesDirectory(repo.mainRoot, config);
  const top = path.resolve(await git(ctx.root, ["rev-parse", "--show-toplevel"]));
  const feature = ctx.payload.feature?.id;

  if (path.dirname(top) === directory) {
    const { state } = await managedWorktree(top, config);
    const conflict = incompatibility(state, identifiesWork(ctx.payload) ? workItem(ctx.payload) : undefined, feature);
    if (conflict) throw new Error(`Cannot continue here: ${conflict}.`);
    return { message: `Using ${state.branch} in ${state.path}`, worktree: handoff(state) };
  }

  const work = workItem(ctx.payload);
  if (feature && work.kind !== "plan" && work.kind !== "yolo") {
    const owners = await activeOwners(repo, feature);
    if (owners.length > 1) {
      throw new Error(`${feature} belongs to more than one active workflow (${owners.map((owner) => owner.identity).join(", ")}). Clean up the finished one with \`spec-lite worktree cleanup <name>\`.`);
    }
    if (owners.length === 1) {
      await excludeWorktrees(repo.mainRoot, directory);
      return { message: `Using ${owners[0].branch} (${owners[0].identity}) in ${owners[0].path}`, worktree: handoff(owners[0]) };
    }
  }
  if (await fs.pathExists(directory) && (await fs.lstat(directory)).isSymbolicLink()) throw new Error("The worktree directory must not be a symlink or junction.");
  const destination = path.join(directory, work.name);
  return withWorkflowLock(repo.commonDir, destination, () => createOrResume(ctx, config, repo, work, top, destination));
}

/** Commit subject from `gitWorkflow.commitMessage`, or `<id> <task>: <summary>`. */
export function commitSubject(config: GitWorkflowConfig, state: WorkflowState, payload: HookPayload): string {
  const summary = (payload.summary ?? "Code changes").replace(/[\r\n]+/g, " ").trim().slice(0, 160);
  const vars: Record<string, string> = { id: payload.feature?.id ?? state.branch, task: payload.task?.id ?? "", summary, branch: state.branch };
  if (!config.commitMessage) return `${vars.id}${vars.task ? ` ${vars.task}` : ""}: ${summary}`;
  return config.commitMessage.replace(COMMIT_TEMPLATE_RE, (_, name: string, fallback?: string) => vars[name] || fallback || "")
    .replace(/\s+/g, " ").trim();
}

const LOG_PATHSPEC = ".spec-lite/**/hooks.log.jsonl";

export async function commitProgress(ctx: BuiltinContext): Promise<BuiltinOutcome> {
  const config = await gitWorkflowConfig(ctx.root);
  const { state, repo } = await managedWorktree(ctx.root, config);
  return withWorkflowLock(repo.commonDir, state.path, async () => {
    const stagedLogs = await git(state.path, ["diff", "--cached", "--name-only", "--", LOG_PATHSPEC]);
    if (stagedLogs) throw new Error(`Unstage hook logs before committing progress: ${stagedLogs.split("\n").join(", ")}`);
    // changeset.json is committed: its content changes only when the changed
    // files do, so a retry stages nothing and creates no commit.
    await git(state.path, ["add", "--all", "--", ".", `:(exclude)${LOG_PATHSPEC}`]);
    const staged = await git(state.path, ["diff", "--cached", "--name-only"]);
    let message = "No changes to commit";
    if (staged) {
      await git(state.path, ["commit", "-m", commitSubject(config, state, ctx.payload)], ctx.hook?.timeoutMs);
      message = `Committed ${await git(state.path, ["rev-parse", "--short", "HEAD"])}`;
    }
    if (COMPLETION_EVENTS.includes(ctx.payload.event)) {
      // Specs and changesets are always committed, so judge the work by what
      // changed outside them: nothing there means the edits went elsewhere.
      const work = await git(state.path, ["diff", "--name-only", `${state.initialHead}..HEAD`, "--", ".", ":(exclude).spec-lite", ":(exclude).spec-lite.json"]);
      if (!work) {
        throw new Error(`${state.branch} has no changes outside .spec-lite since it started, so nothing was pushed. Were the edits made outside ${state.path}, for example in ${state.mainRoot}?`);
      }
      const remote = config.remote ?? "origin";
      await git(state.path, ["remote", "get-url", remote]);
      await git(state.path, ["push", "--set-upstream", remote, `HEAD:refs/heads/${state.branch}`], ctx.hook?.timeoutMs ?? 120000);
      message += `; pushed ${state.branch} to ${remote}`;
    }
    return { message };
  });
}
