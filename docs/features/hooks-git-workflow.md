# Git workflow hooks

Three opt-in [built-in hooks](hooks.md#built-in-hooks) give each piece of work
its own worktree, branch, commits, and pull request:

| Hook | Runs at | Does |
|---|---|---|
| `prepare-worktree` | `implement.pre`, `implement.task.pre`, `fix.pre` | Creates or resumes the work's worktree and branch; at a task, only resumes |
| `commit-progress` | `implement.task.post`, `implement.post`, `fix.post` | Commits each finished task; at completion, commits the rest and pushes |
| `create-pull-request` | `implement.post`, `fix.post` | Opens the pull request, or reuses the existing one |

They cover Implement (every mode) and Fix. A run goes like this:

1. **Start.** At the start of an implementation or fix, a worktree is created at `.worktrees/<name>` on a new branch from the configured start branch: one worktree for the whole implementation, not one per task. The work's specs, plan, and settings are copied in, including uncommitted ones, and the agent works there from then on.
2. **Each task.** Before a task, the feature's worktree is resumed if it exists, so you can stop mid-feature, work on something else, and later pick up at the next task. A task never creates a worktree. Each finished task is committed.
3. **Completion.** Remaining changes are committed, the branch is pushed, and the pull request is opened.
4. **After you merge.** Run `spec-lite worktree cleanup <name>` in your main checkout, then pull.

- [Requirements](#requirements)
- [Set up](#set-up)
- [Options](#options)
- [Branches and worktrees](#branches-and-worktrees)
- [After merging](#after-merging)
- [What the hooks guarantee](#what-the-hooks-guarantee)
- [Limitations](#limitations)
- [Custom PR provider](#custom-pr-provider)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)

## Requirements

- Git 2.36 or newer.
- Push access that never prompts: SSH, or HTTPS with a credential helper. Hooks run with `GIT_TERMINAL_PROMPT=0`.
- For pull requests, one of:
  - **GitHub:** `gh` on `PATH` and signed in (`gh auth status`).
  - **Azure DevOps:** `az` with `az extension add --name azure-devops`, signed in with `az login` or `AZURE_DEVOPS_EXT_PAT`.
  - **Anything else:** your own adapter. See [Custom PR provider](#custom-pr-provider).

## Set up

`spec-lite init` asks whether to set up these hooks. For each one, you choose to
enable or skip it, and you're asked only for the options it needs. A hook that
needs one you skipped isn't offered. `spec-lite update` asks the same about any
of these hooks you haven't decided on yet, such as one added in a newer release.
Change your answers at any time with:

```bash
spec-lite hook setup                        # all three
spec-lite hook setup create-pull-request    # just one
```

Without a terminal (CI), or with `--skip-hooks`, `init` and `update` don't ask.

Setup writes short entries to `.spec-lite/hooks.json`. Each holds only your
choices; the hook definitions stay in spec-lite and update with it. You can also
write them by hand:

<!-- git-workflow-hooks-json:start -->
```json
{
  "version": 1,
  "hooks": [
    {
      "name": "prepare-worktree",
      "enabled": true,
      "options": {
        "fromBranch": "develop"
      }
    },
    {
      "name": "commit-progress",
      "enabled": true
    },
    {
      "name": "create-pull-request",
      "enabled": true,
      "options": {
        "provider": "github",
        "targetBranch": "develop"
      }
    }
  ]
}
```
<!-- git-workflow-hooks-json:end -->

- **No pull request:** to stop at a pushed branch, leave out `create-pull-request` or set it to `"enabled": false`.
- **Dependencies:** `commit-progress` needs `prepare-worktree`, and `create-pull-request` needs `commit-progress`.

Then check, and preview what the next feature will do:

```bash
spec-lite hook validate
spec-lite hook run implement.pre --feature FEAT-001 --dry-run
```

## Options

Each hook's settings go in the `options` object of its own entry:

<!-- builtin-options-table:git-workflow:start -->
| Hook | Option | Type | Meaning |
|---|---|---|---|
| `prepare-worktree` | `fromBranch` | string | Branch new worktrees start from: local (`develop`) or remote-tracking (`origin/develop`). Default: the main checkout's current branch; `validate` warns when unset. |
| `prepare-worktree` | `fetch` | boolean | Fetch `fromBranch` from `remote` first and start from the remote's latest commit. Default: `false`. |
| `prepare-worktree` | `remote` | string | Remote `fetch` reads from. Default: `origin`. |
| `prepare-worktree` | `worktreeRoot` | string | Folder for worktrees, relative to the main checkout. Default: `.worktrees`. |
| `commit-progress` | `remote` | string | Remote to push to. Recorded for `create-pull-request` and cleanup. Default: `origin`. |
| `commit-progress` | `commitMessage` | string | Commit subject template using `${id}` (feature ID, or the branch), `${task}`, `${summary}`, and `${branch}`; `${task:-final}` sets a default. Default: `FEAT-020 TASK-003: <summary>`. |
| `create-pull-request` | `provider` | `"github"`, `"azure-devops"`, `"command"` | **Required.** Where pull requests are opened; `command` runs your own adapter. |
| `create-pull-request` | `targetBranch` | string | **Required.** Branch pull requests merge into. Never inferred. |
| `create-pull-request` | `command` | string array | `command` provider: executable and arguments that create a PR. |
| `create-pull-request` | `lookupCommand` | string array | `command` provider: executable and arguments that find existing PRs. |
<!-- builtin-options-table:git-workflow:end -->

Each setting belongs to one hook only. Values a later step needs are recorded in
the workflow's saved state the first time they're used, so you never repeat a
setting or keep two copies in sync:

- `prepare-worktree` records the start branch and where the worktree is.
- `commit-progress` records the remote it pushed to. `create-pull-request` and `spec-lite worktree cleanup` use that same remote, which also lets you fetch from one remote and push to another, such as a fork.
- `spec-lite worktree cleanup` reads `targetBranch` and `provider` from the `create-pull-request` entry, even when that hook is disabled.

Besides `options`, a short entry may set only these, within the limits that
`hook validate` enforces:

| Property | Limits |
|---|---|
| `enabled` | Within the dependencies above. |
| `order` | `prepare-worktree` must run first on its events. `commit-progress` must run after `capture-changeset` (order `10`), and `create-pull-request` after `commit-progress`. Give your own checks, such as lint or tests, an order between `10` and `200`, so they run before the commit. |
| `timeoutMs` | No limit. It's the budget for each Git or provider command the hook runs: creating the worktree, a commit or push, or a pull request call. |
| `onFailure` | Must stay `"abort"`, so a failed step stops the run. |

## Branches and worktrees

| Work | Started by | Branch | Worktree |
|---|---|---|---|
| One feature | Implement | `ft/feat-020-execute-operations` | `.worktrees/feat-020-execute-operations` |
| A whole plan | Implement, Plan Mode | `plan/orders` (from `plan_orders.md`) | `.worktrees/plan-orders` |
| A fix | Fix | `fix/auth-issue` | `.worktrees/fix-auth-issue` |
| A small change | Implement, Change Mode | `chg/add-json-flag` | `.worktrees/change-add-json-flag` |
| Review findings | Implement, Review Mode | `review/checkout` (from `review_checkout.md`) | `.worktrees/review-checkout` |
| A YOLO run | YOLO | `yolo/20261006-store` | `.worktrees/yolo-20261006-store` |

- **Names are stable.** They come from the feature directory, the plan file, the review report, or the YOLO Run ID, so a retry or a resumed session gets the same branch. A fix or a change uses the name the agent passes: your ticket ID when you give one.
- **A plan or YOLO run is one branch.** Each feature builds on the previous ones, and the pull request opens when the whole run completes. A feature implemented on its own gets its own branch.
- **Follow-up work joins its feature.** A fix or review remediation for a feature whose worktree still exists goes onto that branch and updates its pull request.
- **Name format.** Names use lowercase letters, digits, and hyphens. Names longer than 60 characters end in a short hash.

## After merging

```bash
spec-lite worktree list
spec-lite worktree cleanup feat-020-execute-operations   # or --merged for all
git pull
```

Run cleanup from the main checkout, before pulling. It first checks that the
branch is merged into the pull request's `targetBranch`, or into the start
branch when there is no PR hook. For a squash merge, it asks the PR provider
whether that exact commit merged. If the branch isn't merged, cleanup removes
nothing. Otherwise it:

1. Removes the worktree. This is never forced; Git refuses if there are uncommitted changes.
2. Deletes the local branch. Remote branches are left to your Git host.
3. Resets specs that were copied from your main checkout while uncommitted, so your identical local copies don't block `git pull`. Files you've changed since are kept.
4. Forgets the workflow. Starting the same work again creates a fresh branch from the start branch's current commit.

## What the hooks guarantee

- **No duplicates.** Retrying any step reuses the same worktree, branch, and pull request. There are no empty commits and no force-pushes.
- **Each task is committed with its `changeset.json`.** Its content changes only when the changed files do, so a retry commits nothing.
- **Hook logs are never committed.** spec-lite adds `.spec-lite/**/hooks.log.jsonl` and the worktree folder to `.git/info/exclude`, and edits no tracked file. See [Audit log](hooks.md#audit-log).
- **Failures stop the run.** Each hook uses `onFailure: "abort"`. Your own hooks ordered before `200`, such as lint or tests, run before the commit.
- **Work in the wrong checkout is caught.** Committing outside a managed worktree is refused, and the error names the worktree the work belongs to. A completion with no changes outside `.spec-lite/` fails instead of pushing.
- **New work never goes silently onto a merged PR.** If the branch's pull request is merged or closed and the branch has new commits, the PR step fails.
- **Interrupted runs recover.** A rerun finishes an interrupted setup, and a lock left by a killed process is taken over once that process has exited.

## Limitations

- **Tools scan the worktree folder.** `.worktrees/` is inside your checkout, and test runners and compilers ignore `.gitignore`. Exclude it from them, for example vitest `exclude: ["**/.worktrees/**"]`, jest `testPathIgnorePatterns`, tsconfig `exclude`, or ESLint `ignores`. Alternatively, point `prepare-worktree`'s `worktreeRoot` outside the checkout, if your agent is allowed to write there.
- **Dependencies aren't installed.** A new worktree has no `node_modules` and none of your git-ignored files, such as `.env`. A `command` hook on `implement.pre` and `fix.pre` with `"order": 5` runs inside the new worktree and can install them.
- **Only Implement and Fix are covered.** Document, test-writing, and DevOps roles edit whichever checkout they run in.
- **Completions can be slow.** Pushing and opening a pull request can take minutes. Give your agent's command timeout at least 5 minutes for `implement.post` and `fix.post`.
- **One configuration per repository.** Every workflow in a repository uses the same hook options. Entries in `~/.spec-lite/hooks.json` give all your repositories a default, and a project entry replaces it.
- **Skip all three or none.** To work without the Git workflow for one run, skip all three hooks; `commit-progress` fails without the worktree that `prepare-worktree` makes. See [Skipping hooks for one run](hooks.md#skipping-hooks-for-one-run).

## Custom PR provider

Choose `command` as the provider in `spec-lite hook setup`, or set it in the
`create-pull-request` entry. Give both commands as literal executable and
argument arrays. No shell is involved:

```json
{
  "name": "create-pull-request",
  "enabled": true,
  "options": {
    "provider": "command",
    "targetBranch": "develop",
    "command": ["node", "scripts/pr-adapter.cjs", "create"],
    "lookupCommand": ["node", "scripts/pr-adapter.cjs", "lookup"]
  }
}
```

**Inputs.** Both commands receive these environment variables. Pull request
text arrives only this way, never as arguments:

| Variable | Value |
|---|---|
| `SPEC_LITE_PR_HEAD` | The branch to merge from, such as `ft/feat-020-execute-operations` |
| `SPEC_LITE_PR_BASE` | The configured `targetBranch` |
| `SPEC_LITE_PR_TITLE` | `<feature ID or plan>: <summary>`, at most 200 characters |
| `SPEC_LITE_PR_BODY_FILE` | A temporary Markdown file: the summary, then the list of commit subjects |
| `SPEC_LITE_PR_REMOTE` | The remote `commit-progress` pushed to |
| `SPEC_LITE_PR_REMOTE_URL` | That remote's URL |

In a `.cmd` adapter, don't expand `%SPEC_LITE_PR_TITLE%` unquoted; a Node or
Python adapter avoids cmd.exe parsing altogether.

**Lookup output.** Print JSON `null` when there is no pull request, or an object
(or an array of objects) for matching pull requests, including closed and merged
ones:

- `url`: required.
- `state`: `open`, `closed`, or `merged`. Without it, the pull request is treated as open.
- `headSha`: the pull request's source commit. Cleanup needs it to confirm a squash merge.

Fail with a non-zero exit on API or authentication errors; never print `null`
for a failed lookup.

**Create output.** Print `{"url": "https://..."}`.

The commands inherit the process environment for credentials. Keep secrets out
of the registry and out of command output.

## How it works

- **Handoff to the agent.** A subprocess can't change its caller's directory, so `prepare-worktree` prints `SPEC-LITE-WORKTREE {"path": …, "branch": …}` (or `payload.worktree` with `--json`), and Implement and Fix move to that path. The remaining hooks of the same event already run there.
- **Choosing the workflow.** The CLI checks these in order:
  1. `--feature` given, and the feature has an open workflow: use it, wherever the hook runs from. That is either the feature's own workflow, or a plan or YOLO workflow whose plans list it. This is how a task resumes its feature, even from another workflow's worktree.
  2. Already inside a managed worktree: continue in it. A fix, change, or review remediation started there joins that branch. Starting a different feature, plan, or YOLO run there is an error; start it from the main checkout.
  3. At `implement.task.pre`: stop. A task resumes a worktree but never creates one.
  4. Otherwise: create or resume the feature, plan (`--payload plan=<file>`), YOLO (`--payload yolo=<Run ID>`), fix (`fix.pre --payload name=…`), change (`implement.pre --payload change=…`), or review (`implement.pre --payload name=…`) workflow.
- **What the roles pass.** Implement and Fix choose the workflow through the flags on their hook calls: `--feature FEAT-020` for a feature, `--payload plan=.spec-lite/plan_orders.md` for a plan, `--payload name=auth-issue` for a fix, `--payload change=add-json-flag` for a change. A change never takes `--feature`. Started from the main checkout, it gets its own workflow and `chg/` branch. To use the workflow without an agent, see [Running hooks yourself](hooks.md#running-hooks-yourself).
- **State.** Workflow state and locks live in `.git/spec-lite/`, outside every commit.

## Troubleshooting

| Message | What to do |
|---|---|
| `Another spec-lite hook is using this workflow` | Wait for the other run. If no spec-lite process is running, delete the lock file the message names. |
| `… has no worktree, but branch … still exists` | If it was merged: `spec-lite worktree cleanup <name>`. If not: `git worktree add <path> <branch>` resumes it. |
| `Branch … already exists outside this workflow` | Rename or delete that branch. |
| `… is not a worktree made by prepare-worktree` | The work ran outside its worktree, or `prepare-worktree` was skipped. Start with `implement.pre` or `fix.pre`, or skip all three hooks. |
| `… has no changes outside .spec-lite` | The edits landed in another checkout. Move them into the worktree and rerun. |
| `Pull request … is merged, and the branch has commits it does not contain` | Reopen the pull request, or move those commits to a new workflow. |
| `Cannot continue here: this worktree belongs to …` | Run that work from the main checkout. |
| Push rejected | Someone else pushed to the branch. Pull in the worktree and rerun. |
| Tests run twice in the main checkout | Exclude the worktree folder; see [Limitations](#limitations). |

## Related

- [Hooks](hooks.md): concepts, hook types, and the reference
- [CLI reference](../usage.md#worktree): `spec-lite worktree list` and `cleanup`
