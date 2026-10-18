/**
 * The end of a workflow's lifecycle, run explicitly by the user after merging:
 * verify the merge, then remove the worktree, branch, and state. Hooks never
 * remove anything; `git worktree remove` is never forced.
 */
import path from "node:path";
import fs from "fs-extra";
import {
  git,
  isActive,
  listStates,
  localBranchExists,
  readState,
  repository,
  stateFile,
  type Repository,
  type WorkflowState,
} from "./git-workflow.js";
import { findPullRequest } from "./pull-request.js";
import { validateBuiltinOptions } from "./options.js";
import { loadRegistry } from "../registry.js";
import type { PullRequestOptions } from "../types.js";

const succeeds = (action: Promise<unknown>) =>
  action.then(
    () => true,
    () => false
  );

export interface WorkflowSummary {
  name: string;
  identity: string;
  branch: string;
  path: string;
  status: "active" | "no worktree" | "incomplete";
}

export async function listWorkflows(root: string): Promise<WorkflowSummary[]> {
  const repo = await repository(root);
  return (await listStates(repo.commonDir)).map((state) => ({
    name: state.name,
    identity: state.identity,
    branch: state.branch,
    path: state.path,
    status: !state.ready
      ? "incomplete"
      : isActive(state, repo)
        ? "active"
        : "no worktree",
  }));
}

interface MergeStatus {
  merged: boolean;
  detail: string;
  targetTip?: string;
}

/**
 * The create-pull-request entry's options, even when that hook is disabled:
 * cleanup needs its target branch and provider, not the hook itself.
 */
async function pullRequestOptions(
  root: string
): Promise<PullRequestOptions | undefined> {
  const { hooks } = await loadRegistry(root, { includeDisabled: true });
  const hook = hooks.find(
    (entry) =>
      entry.type === "builtin" &&
      (entry.builtin ?? entry.name) === "create-pull-request"
  );
  const options = hook?.options as PullRequestOptions | undefined;
  return options &&
    !validateBuiltinOptions("create-pull-request", options).errors.length
    ? options
    : undefined;
}

async function mergeStatus(
  repo: Repository,
  pr: PullRequestOptions | undefined,
  state: WorkflowState
): Promise<MergeStatus> {
  const tip = await git(repo.mainRoot, [
    "rev-parse",
    `refs/heads/${state.branch}`,
  ]);
  // The remote commit-progress pushed to. A branch never pushed can only
  // have been merged locally.
  const remote = state.remote;
  const target = pr?.targetBranch ?? state.fromBranch;
  let targetTip: string | undefined;
  try {
    if (!remote) throw new Error("not pushed");
    await git(
      repo.mainRoot,
      ["fetch", "--no-tags", remote, `refs/heads/${target}`],
      120000
    );
    targetTip = await git(repo.mainRoot, ["rev-parse", "FETCH_HEAD"]);
  } catch {
    targetTip = await git(repo.mainRoot, [
      "rev-parse",
      "--verify",
      `${target}^{commit}`,
    ]).catch(() => undefined);
  }
  if (
    targetTip &&
    (await succeeds(
      git(repo.mainRoot, ["merge-base", "--is-ancestor", tip, targetTip])
    ))
  ) {
    return { merged: true, detail: `merged into ${target}`, targetTip };
  }
  // A squash or rebase merge leaves no ancestry; only the provider knows.
  if (pr && remote) {
    const remoteUrl = await git(repo.mainRoot, ["remote", "get-url", remote]);
    const found = await findPullRequest({
      root: repo.mainRoot,
      head: state.branch,
      base: pr.targetBranch!,
      title: "",
      bodyFile: "",
      remote,
      remoteUrl,
      timeout: 120000,
      options: pr,
    });
    if (found?.state === "merged" && found.headSha === tip)
      return {
        merged: true,
        detail: `pull request ${found.url} merged`,
        targetTip,
      };
    if (found?.state === "merged") {
      return {
        merged: false,
        detail: `${state.branch} has commits that pull request ${found.url} did not merge (or the provider did not report its head). Move them to a new branch; nothing was removed.`,
      };
    }
  }
  return {
    merged: false,
    detail: `${state.branch} is not merged into ${target}. Merge its pull request first; nothing was removed.`,
  };
}

/**
 * Reset copied inputs in the checkout they came from, so pulling the merged
 * branch is not blocked by identical local edits. Only files unchanged since
 * the copy, and present in the merged target, are reset.
 */
async function restoreInputs(
  state: WorkflowState,
  targetTip: string | undefined
): Promise<string[]> {
  if (!state.source || !state.copied?.length) return [];
  const lines: string[] = [];
  for (const input of state.copied) {
    const current = await git(state.source, [
      "hash-object",
      "--",
      input.path,
    ]).catch(() => undefined);
    if (current !== input.hash) {
      lines.push(
        `Kept ${input.path}: changed in ${state.source} since the workflow started`
      );
      continue;
    }
    if (
      !targetTip ||
      !(await succeeds(
        git(state.source, ["cat-file", "-e", `${targetTip}:${input.path}`])
      ))
    ) {
      lines.push(`Kept ${input.path}: not in the merged branch`);
      continue;
    }
    if (
      await succeeds(
        git(state.source, ["ls-files", "--error-unmatch", "--", input.path])
      )
    ) {
      await git(state.source, ["checkout", "HEAD", "--", input.path]);
    } else {
      await fs.remove(path.join(state.source, input.path));
    }
    lines.push(
      `Reset ${input.path} in ${state.source}; pulling brings the merged version`
    );
  }
  return lines;
}

/** Clean up one finished workflow. Returns what was done; throws, having removed nothing, when it is not merged. */
export async function cleanupWorkflow(
  root: string,
  name: string
): Promise<string[]> {
  const repo = await repository(root);
  const state = await readState(repo.commonDir, name);
  if (!state)
    throw new Error(
      `No workflow named ${name}. Run \`spec-lite worktree list\`.`
    );
  const here = path.resolve(root);
  const worktree = path.resolve(state.path);
  if (here === worktree || here.startsWith(worktree + path.sep))
    throw new Error(
      "Run cleanup from the main checkout, not from the worktree being removed."
    );

  const branchExists = await localBranchExists(repo.mainRoot, state.branch);
  const merge = branchExists
    ? await mergeStatus(repo, await pullRequestOptions(root), state)
    : undefined;
  if (merge && !merge.merged) throw new Error(merge.detail);

  const done: string[] = [];
  if (repo.entries.some((entry) => entry.path === worktree)) {
    await git(repo.mainRoot, ["worktree", "remove", worktree]);
    done.push(`Removed worktree ${worktree}`);
  }
  if (branchExists) {
    // The merge was verified above against the fetched target, or by the
    // provider for that exact commit. `-d` would instead compare with the main
    // checkout's HEAD, which may not be pulled yet and never contains a
    // squash-merged branch.
    await git(repo.mainRoot, ["branch", "-D", state.branch]);
    done.push(`Deleted branch ${state.branch} (${merge?.detail})`);
  }
  done.push(...(await restoreInputs(state, merge?.targetTip)));
  await fs.remove(stateFile(repo.commonDir, name));
  done.push(`Removed workflow state for ${state.identity}`);
  return done;
}

/** Clean up every workflow whose branch is merged or gone; skip the rest. */
export async function cleanupMerged(root: string): Promise<string[]> {
  const repo = await repository(root);
  const done: string[] = [];
  for (const state of await listStates(repo.commonDir)) {
    try {
      done.push(...(await cleanupWorkflow(root, state.name)));
    } catch (err) {
      done.push(`Skipped ${state.name}: ${(err as Error).message}`);
    }
  }
  return done;
}
