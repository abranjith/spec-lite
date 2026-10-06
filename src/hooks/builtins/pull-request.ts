/** Provider adapters query before creation, so retries cannot duplicate an open PR. */
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { BuiltinContext, BuiltinOutcome } from "./index.js";
import type { GitHookOptions } from "../types.js";
import { git, managedWorktree, runProgram, withWorkflowLock } from "./git-workflow.js";

interface PrContext {
  root: string; head: string; base: string; title: string; bodyFile: string;
  remote: string; remoteUrl: string; timeout: number; options: GitHookOptions;
}

function validUrl(value: unknown): string {
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) throw new Error("PR adapter must return an HTTP(S) pull request URL.");
  return value;
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

const adapterCommand = (ctx: PrContext, bin: string, args: string[], env?: NodeJS.ProcessEnv) => runProgram(ctx.root, bin, args, ctx.timeout, env);

export async function findPullRequest(ctx: PrContext): Promise<string | undefined> {
  if (ctx.options.provider === "github") {
    const repo = githubRepository(ctx.remoteUrl);
    const rows = JSON.parse(await adapterCommand(ctx, "gh", ["pr", "list", "--repo", repo, "--head", ctx.head, "--base", ctx.base, "--state", "all", "--json", "url", "--limit", "1"])) as Array<{ url: string }>;
    return rows.length ? validUrl(rows[0].url) : undefined;
  }
  if (ctx.options.provider === "azure-devops") {
    const repo = azureRepository(ctx.remoteUrl);
    const rows = JSON.parse(await adapterCommand(ctx, "az", ["repos", "pr", "list", "--organization", repo.organization, "--project", repo.project,
      "--repository", repo.repository, "--source-branch", ctx.head, "--target-branch", ctx.base, "--status", "all", "--top", "1", "--output", "json"])) as Array<{ pullRequestId: number }>;
    if (rows.length && !Number.isInteger(rows[0].pullRequestId)) throw new Error("Azure DevOps did not return a pull request ID.");
    return rows.length ? `${repo.organization}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${rows[0].pullRequestId}` : undefined;
  }
  const response = await customCommand(ctx, ctx.options.lookupCommand!);
  return response === null ? undefined : validUrl(response.url);
}

async function customCommand(ctx: PrContext, command: string[]): Promise<{ url: string } | null> {
  const env = {
    SPEC_LITE_PR_HEAD: ctx.head, SPEC_LITE_PR_BASE: ctx.base, SPEC_LITE_PR_TITLE: ctx.title,
    SPEC_LITE_PR_BODY_FILE: ctx.bodyFile, SPEC_LITE_PR_REMOTE: ctx.remote, SPEC_LITE_PR_REMOTE_URL: ctx.remoteUrl,
  };
  return JSON.parse(await adapterCommand(ctx, command[0], command.slice(1), env));
}

async function create(ctx: PrContext): Promise<string> {
  if (ctx.options.provider === "github") {
    const repo = githubRepository(ctx.remoteUrl);
    return validUrl(await adapterCommand(ctx, "gh", ["pr", "create", "--repo", repo, "--head", ctx.head, "--base", ctx.base, "--title", ctx.title, "--body-file", ctx.bodyFile]));
  }
  if (ctx.options.provider === "azure-devops") {
    const repo = azureRepository(ctx.remoteUrl);
    const body = await fs.readFile(ctx.bodyFile, "utf8");
    const response = JSON.parse(await adapterCommand(ctx, "az", ["repos", "pr", "create", "--organization", repo.organization, "--project", repo.project,
      "--repository", repo.repository, "--source-branch", ctx.head, "--target-branch", ctx.base, "--title", ctx.title, "--description", body,
      "--output", "json"])) as { pullRequestId: number };
    if (!Number.isInteger(response.pullRequestId)) throw new Error("Azure DevOps did not return a pull request ID.");
    return `${repo.organization}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${response.pullRequestId}`;
  }
  const response = await customCommand(ctx, ctx.options.command!);
  return validUrl(response?.url);
}

export function validatePrOptions(options: GitHookOptions | undefined): string[] {
  const errors: string[] = [];
  if (!options?.targetBranch?.trim()) errors.push("create-pull-request requires options.targetBranch; no default target is inferred.");
  if (!options?.provider) errors.push("create-pull-request requires options.provider (github, azure-devops, or command).");
  if (options?.provider === "command") {
    if (!options.command?.[0]?.trim()) errors.push("The command PR adapter requires options.command (executable and arguments).");
    if (!options.lookupCommand?.[0]?.trim()) errors.push("The command PR adapter requires options.lookupCommand to prevent duplicate PRs.");
  }
  return errors;
}

export async function createPullRequest(ctx: BuiltinContext): Promise<BuiltinOutcome> {
  const options = ctx.hook?.options;
  const errors = validatePrOptions(options);
  if (errors.length) throw new Error(errors.join("\n"));
  const { state, commonDir } = await managedWorktree(ctx.root);
  return withWorkflowLock(commonDir, state.path, async () => {
    const remote = options?.remote ?? "origin";
    const base = options!.targetBranch!;
    await git(state.path, ["check-ref-format", "--branch", base]);
    const remoteUrl = await git(state.path, ["remote", "get-url", remote]);
    const headSha = await git(state.path, ["rev-parse", "HEAD"]);
    const pushed = await git(state.path, ["ls-remote", "--heads", remote, `refs/heads/${state.branch}`], ctx.hook?.timeoutMs ?? 120000);
    if (pushed.split(/\s+/)[0] !== headSha) throw new Error("Push the completed branch before creating its pull request; commit-progress may not have completed.");
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-pr-"));
    try {
      const summary = (ctx.payload.summary ?? `Changes on ${state.branch}`).replace(/[\r\n]+/g, " ").trim();
      const title = `${ctx.payload.feature?.id ? `${ctx.payload.feature.id}: ` : ""}${summary}`.slice(0, 200);
      const commits = await git(state.path, ["log", "--format=- %s", `${state.initialHead}..HEAD`]);
      const bodyFile = path.join(temp, "body.md");
      await fs.writeFile(bodyFile, `${summary}\n\n${commits || "Changes completed on the source branch."}\n`);
      const pr: PrContext = { root: state.path, head: state.branch, base, title, bodyFile, remote, remoteUrl, timeout: ctx.hook?.timeoutMs ?? 120000, options: options! };
      let url = await findPullRequest(pr);
      let reused = !!url;
      if (!url) {
        await git(state.path, ["fetch", "--no-tags", remote, `refs/heads/${base}`], pr.timeout);
        const changes = await git(state.path, ["diff", "--name-only", "FETCH_HEAD...HEAD"]);
        if (!changes) return { message: `No changes against ${base}; no pull request created.` };
        // A lost creation response or another client winning the race must not
        // make a retry create a second PR. Query again before surfacing errors.
        try { url = await create(pr); }
        catch (err) { url = await findPullRequest(pr); if (!url) throw err; reused = true; }
      }
      const quote = (value: string) => `'${value.replace(/'/g, process.platform === "win32" ? "''" : "'\\''")}'`;
      return { message: `${reused ? "Existing" : "Created"} pull request: ${url}\nAfter merging, leave the worktree and clean up explicitly:\ngit -C ${quote(state.mainRoot)} worktree remove ${quote(state.path)}` };
    } finally { await fs.remove(temp); }
  });
}
