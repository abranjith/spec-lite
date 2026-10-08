/**
 * Validation for the `gitWorkflow` block of `.spec-lite.json`. Pure: no Git
 * or filesystem access, so `hook validate` can report every problem before a
 * workflow touches the repository.
 */
import path from "node:path";
import type { PullRequestConfig } from "../types.js";

/** Variables a `gitWorkflow.commitMessage` template may reference. */
export const COMMIT_VARS = ["id", "task", "summary", "branch"] as const;
export const COMMIT_TEMPLATE_RE = /\$\{(\w+)(?::-([^}]*))?\}/g;

const KEYS = ["fromBranch", "fetch", "remote", "worktreeRoot", "commitMessage", "pullRequest"];
const PR_KEYS = ["provider", "targetBranch", "command", "lookupCommand"];
const PROVIDERS = ["github", "azure-devops", "command"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Branch and remote names are passed to Git and provider CLIs as single arguments. */
function refError(key: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.startsWith("-")) {
    return `gitWorkflow.${key} must be a non-empty name that does not start with a hyphen.`;
  }
  return undefined;
}

const commandError = (key: string, value: unknown): string | undefined =>
  value === undefined || (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") && value[0].trim())
    ? undefined
    : `gitWorkflow.pullRequest.${key} must be an array: the executable followed by its arguments.`;

export function validatePullRequestConfig(pr: PullRequestConfig | undefined): string[] {
  const errors: string[] = [];
  if (!pr?.targetBranch?.trim()) errors.push("create-pull-request needs gitWorkflow.pullRequest.targetBranch in .spec-lite.json; no default target is inferred.");
  if (!pr?.provider) errors.push("create-pull-request needs gitWorkflow.pullRequest.provider (github, azure-devops, or command).");
  if (pr?.provider === "command") {
    if (!pr.command?.[0]?.trim()) errors.push("The command provider needs gitWorkflow.pullRequest.command (executable and arguments).");
    if (!pr.lookupCommand?.[0]?.trim()) errors.push("The command provider needs gitWorkflow.pullRequest.lookupCommand, which prevents duplicate PRs.");
  }
  return errors;
}

export interface ConfigReport { errors: string[]; warnings: string[] }

/**
 * Check the block for the hooks that are enabled. `needsPullRequest` adds the
 * settings `create-pull-request` cannot run without.
 */
export function validateGitWorkflowConfig(raw: unknown, needsPullRequest: boolean): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (raw !== undefined && !isObject(raw)) return { errors: ["gitWorkflow in .spec-lite.json must be an object."], warnings };
  const config = (raw ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(config)) if (!KEYS.includes(key)) errors.push(`gitWorkflow.${key} is not a recognized setting.`);
  for (const key of ["fromBranch", "remote"]) {
    const error = refError(key, config[key]);
    if (error) errors.push(error);
  }
  if (config.fetch !== undefined && typeof config.fetch !== "boolean") errors.push("gitWorkflow.fetch must be true or false.");
  if (config.fetch === true && config.fromBranch === undefined) errors.push("gitWorkflow.fetch needs gitWorkflow.fromBranch: the branch to fetch from the remote.");

  if (config.worktreeRoot !== undefined) {
    const root = config.worktreeRoot;
    const normalized = typeof root === "string" ? path.normalize(root.trim()) : "";
    if (!normalized || normalized === "." || normalized.split(/[\\/]/)[0] === ".git") {
      errors.push("gitWorkflow.worktreeRoot must name a directory other than the checkout itself or .git.");
    }
  }

  if (config.commitMessage !== undefined) {
    if (typeof config.commitMessage !== "string" || !config.commitMessage.trim()) {
      errors.push("gitWorkflow.commitMessage must be a non-empty template.");
    } else {
      for (const [, name] of config.commitMessage.matchAll(COMMIT_TEMPLATE_RE)) {
        if (!(COMMIT_VARS as readonly string[]).includes(name)) {
          errors.push(`gitWorkflow.commitMessage uses \${${name}}; available: ${COMMIT_VARS.map((v) => `\${${v}}`).join(", ")}.`);
        }
      }
    }
  }

  const pr = config.pullRequest;
  if (pr !== undefined && !isObject(pr)) errors.push("gitWorkflow.pullRequest must be an object.");
  else if (pr !== undefined) {
    for (const key of Object.keys(pr)) if (!PR_KEYS.includes(key)) errors.push(`gitWorkflow.pullRequest.${key} is not a recognized setting.`);
    if (pr.provider !== undefined && !PROVIDERS.includes(pr.provider as string)) errors.push(`gitWorkflow.pullRequest.provider must be one of ${PROVIDERS.join(", ")}.`);
    const target = refError("pullRequest.targetBranch", pr.targetBranch);
    if (target) errors.push(target);
    for (const key of ["command", "lookupCommand"]) {
      const error = commandError(key, pr[key]);
      if (error) errors.push(error);
    }
  }
  if (needsPullRequest) errors.push(...validatePullRequestConfig(pr as PullRequestConfig | undefined));

  if (config.fromBranch === undefined) {
    warnings.push("gitWorkflow.fromBranch is not set, so each worktree starts from whatever branch the main checkout has checked out.");
  }
  return { errors: [...new Set(errors)], warnings };
}
