/** Provider adapters query before creation, so retries cannot duplicate a PR. */
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { BuiltinContext, BuiltinOutcome } from "./index.js";
import type { HookPayload, PullRequestConfig } from "../types.js";
import { git, gitWorkflowConfig, managedWorktree, runProgram, withWorkflowLock, workItem, type WorkflowState } from "./git-workflow.js";
import { validatePullRequestConfig } from "./git-config.js";

export interface PrContext {
  root: string; head: string; base: string; title: string; bodyFile: string;
  remote: string; remoteUrl: string; timeout: number; config: PullRequestConfig;
}

export interface PullRequestRef {
  url: string;
  state: "open" | "closed" | "merged";
  /** Source commit the PR points at, when the provider reports it. */
  headSha?: string;
}

function validUrl(value: unknown): string {
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) throw new Error("PR adapter must return an HTTP(S) pull request URL.");
  return value;
}

function prState(value: unknown): PullRequestRef["state"] {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  if (state === "open" || state === "closed" || state === "merged") return state;
  throw new Error(`PR adapter returned an unknown pull request state "${String(value)}".`);
}

function githubRepository(remote: string): string {
  const scp = /^(?:[^@/:]+@)?([^/:]+):([^/]+)\/([^/]+)$/.exec(remote);
  if (scp) return `${scp[1]}/${scp[2]}/${scp[3].replace(/\.git$/, "")}`;
  const url = new URL(remote);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("GitHub adapter requires an OWNER/REPO remote URL.");
  return `${url.hostname}/${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
}

function azureRepository(remote: string): { organization: string; project: string; repository: string } {
  const ssh = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (ssh) return { organization: `https://dev.azure.com/${ssh[1]}`, project: decodeURIComponent(ssh[2]), repository: decodeURIComponent(ssh[3]) };
  const url = new URL(remote);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.protocol === "ssh:" && url.hostname === "ssh.dev.azure.com" && parts[0] === "v3" && parts.length === 4) {
    return { organization: `https://dev.azure.com/${parts[1]}`, project: parts[2], repository: parts[3].replace(/\.git$/, "") };
  }
  const index = parts.indexOf("_git");
  if (url.hostname === "dev.azure.com" && index === 2 && parts[3]) {
    return { organization: `https://dev.azure.com/${parts[0]}`, project: parts[1], repository: parts[3].replace(/\.git$/, "") };
  }
  if (url.hostname.endsWith(".visualstudio.com") && index >= 1 && parts[index + 1]) {
    return { organization: url.origin, project: parts[index - 1], repository: parts[index + 1].replace(/\.git$/, "") };
  }
  throw new Error("Azure DevOps adapter requires a dev.azure.com, visualstudio.com, or ssh.dev.azure.com remote.");
}

const azureUrl = (repo: ReturnType<typeof azureRepository>, id: number) =>
  `${repo.organization}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${id}`;

const adapterCommand = (ctx: PrContext, bin: string, args: string[], env?: NodeJS.ProcessEnv) => runProgram(ctx.root, bin, args, ctx.timeout, env);

/** Every PR from the source branch into the target, in any state. */
async function lookup(ctx: PrContext): Promise<PullRequestRef[]> {
  if (ctx.config.provider === "github") {
    const repo = githubRepository(ctx.remoteUrl);
    const rows = JSON.parse(await adapterCommand(ctx, "gh", ["pr", "list", "--repo", repo, "--head", ctx.head, "--base", ctx.base,
      "--state", "all", "--json", "url,state,headRefOid", "--limit", "20"])) as Array<{ url: string; state: string; headRefOid?: string }>;
    return rows.map((row) => ({ url: validUrl(row.url), state: prState(row.state), headSha: row.headRefOid }));
  }
  if (ctx.config.provider === "azure-devops") {
    const repo = azureRepository(ctx.remoteUrl);
    const rows = JSON.parse(await adapterCommand(ctx, "az", ["repos", "pr", "list", "--organization", repo.organization, "--project", repo.project,
      "--repository", repo.repository, "--source-branch", ctx.head, "--target-branch", ctx.base, "--status", "all", "--top", "20", "--output", "json"])) as
      Array<{ pullRequestId: number; status?: string; lastMergeSourceCommit?: { commitId?: string } }>;
    return rows.map((row) => {
      if (!Number.isInteger(row.pullRequestId)) throw new Error("Azure DevOps did not return a pull request ID.");
      const state = row.status === "active" ? "open" : row.status === "completed" ? "merged" : "closed";
      return { url: azureUrl(repo, row.pullRequestId), state, headSha: row.lastMergeSourceCommit?.commitId };
    });
  }
  const response = await customCommand(ctx, ctx.config.lookupCommand!) as unknown;
  const rows = response === null ? [] : Array.isArray(response) ? response : [response];
  return rows.map((row: { url?: unknown; state?: unknown; headSha?: unknown }) => ({
    url: validUrl(row.url),
    // Adapters written before PR states existed report open PRs only.
    state: row.state === undefined ? "open" : prState(row.state),
    headSha: typeof row.headSha === "string" ? row.headSha : undefined,
  }));
}

/** The PR for this branch and target: an open one if any, otherwise the most recent. */
export async function findPullRequest(ctx: PrContext): Promise<PullRequestRef | undefined> {
  const refs = await lookup(ctx);
  return refs.find((ref) => ref.state === "open") ?? refs[0];
}

async function customCommand(ctx: PrContext, command: string[]): Promise<unknown> {
  const env = {
    SPEC_LITE_PR_HEAD: ctx.head, SPEC_LITE_PR_BASE: ctx.base, SPEC_LITE_PR_TITLE: ctx.title,
    SPEC_LITE_PR_BODY_FILE: ctx.bodyFile, SPEC_LITE_PR_REMOTE: ctx.remote, SPEC_LITE_PR_REMOTE_URL: ctx.remoteUrl,
  };
  return JSON.parse(await adapterCommand(ctx, command[0], command.slice(1), env));
}

async function create(ctx: PrContext): Promise<string> {
  if (ctx.config.provider === "github") {
    const repo = githubRepository(ctx.remoteUrl);
    return validUrl(await adapterCommand(ctx, "gh", ["pr", "create", "--repo", repo, "--head", ctx.head, "--base", ctx.base, "--title", ctx.title, "--body-file", ctx.bodyFile]));
  }
  if (ctx.config.provider === "azure-devops") {
    const repo = azureRepository(ctx.remoteUrl);
    const body = await fs.readFile(ctx.bodyFile, "utf8");
    const response = JSON.parse(await adapterCommand(ctx, "az", ["repos", "pr", "create", "--organization", repo.organization, "--project", repo.project,
      "--repository", repo.repository, "--source-branch", ctx.head, "--target-branch", ctx.base, "--title", ctx.title, "--description", body,
      "--output", "json"])) as { pullRequestId: number };
    if (!Number.isInteger(response.pullRequestId)) throw new Error("Azure DevOps did not return a pull request ID.");
    return azureUrl(repo, response.pullRequestId);
  }
  const response = await customCommand(ctx, ctx.config.command!) as { url?: unknown } | null;
  return validUrl(response?.url);
}

/** A workflow's PR is opened by the invocation that completes that workflow, not by work nested in it. */
function completesWorkflow(state: WorkflowState, payload: HookPayload): boolean {
  try { return workItem(payload).identity === state.identity; }
  catch { return false; }
}

function pullRequestTitle(state: WorkflowState, payload: HookPayload, summary: string): string {
  const subject = state.kind === "plan" ? path.posix.basename(state.plan ?? state.name)
    : state.kind === "yolo" ? undefined
    : state.feature ?? payload.feature?.id;
  return `${subject ? `${subject}: ` : ""}${summary}`.slice(0, 200);
}

export async function createPullRequest(ctx: BuiltinContext): Promise<BuiltinOutcome> {
  const config = await gitWorkflowConfig(ctx.root);
  const errors = validatePullRequestConfig(config.pullRequest);
  if (errors.length) throw new Error(errors.join("\n"));
  const settings = config.pullRequest!;
  const { state, repo } = await managedWorktree(ctx.root, config);
  return withWorkflowLock(repo.commonDir, state.path, async () => {
    const remote = config.remote ?? "origin";
    const base = settings.targetBranch!;
    const timeout = ctx.hook?.timeoutMs ?? 120000;
    await git(state.path, ["check-ref-format", "--branch", base]);
    const remoteUrl = await git(state.path, ["remote", "get-url", remote]);
    const headSha = await git(state.path, ["rev-parse", "HEAD"]);
    const pushed = await git(state.path, ["ls-remote", "--heads", remote, `refs/heads/${state.branch}`], timeout);
    if (pushed.split(/\s+/)[0] !== headSha) throw new Error("Push the completed branch before creating its pull request; commit-progress may not have completed.");
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-pr-"));
    try {
      const summary = (ctx.payload.summary ?? `Changes on ${state.branch}`).replace(/[\r\n]+/g, " ").trim();
      const commits = await git(state.path, ["log", "--format=- %s", `${state.initialHead}..HEAD`]);
      const bodyFile = path.join(temp, "body.md");
      await fs.writeFile(bodyFile, `${summary}\n\n${commits || "Changes completed on the source branch."}\n`);
      const pr: PrContext = { root: state.path, head: state.branch, base, title: pullRequestTitle(state, ctx.payload, summary), bodyFile, remote, remoteUrl, timeout, config: settings };
      let found = await findPullRequest(pr);
      // Commits pushed on top of a merged or closed PR reach no reviewer.
      // Reusing it is only right for a retry that changed nothing.
      if (found && found.state !== "open" && found.headSha !== headSha) {
        throw new Error(`Pull request ${found.url} for ${state.branch} is ${found.state}, and the branch has commits it does not contain. Reopen it, or move those commits to a new workflow.`);
      }
      if (!completesWorkflow(state, ctx.payload)) {
        return { message: found ? `Pushed ${state.branch}; it updates pull request ${found.url}` : `Pushed ${state.branch}; its pull request is created when ${state.identity} completes.` };
      }
      let reused = !!found;
      if (!found) {
        await git(state.path, ["fetch", "--no-tags", remote, `refs/heads/${base}`], timeout);
        const changes = await git(state.path, ["diff", "--name-only", "FETCH_HEAD...HEAD"]);
        if (!changes) return { message: `No changes against ${base}; no pull request created.` };
        // A lost creation response or another client winning the race must not
        // make a retry create a second PR. Query again before surfacing errors.
        try { found = { url: await create(pr), state: "open" }; }
        catch (err) {
          found = await findPullRequest(pr);
          if (!found) throw err;
          reused = true;
        }
      }
      const label = reused ? `Existing${found.state === "open" ? "" : ` ${found.state}`}` : "Created";
      return { message: `${label} pull request: ${found.url}\nAfter merging, clean up from the main checkout: spec-lite worktree cleanup ${state.name}` };
    } finally { await fs.remove(temp); }
  });
}
