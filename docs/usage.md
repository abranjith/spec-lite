# CLI reference

The supported public API is the `spec-lite` command-line interface. The package
does not currently expose a stable programmatic JavaScript API.

```text
spec-lite <command> [arguments] [options]
```

Every command supports `-h, --help`; the root command also supports
`-V, --version`.

| Command | High-level behavior |
|---|---|
| [`init`](#init) | Detect providers, collect project/documentation settings, install selected roles locally, and create `.spec-lite.json` |
| [`update`](#update) | Refresh configured project providers and config while preserving Project Context edits |
| [`install --global`](#install) | Install reusable agents and skills in user-level harness directories |
| [`list`](#list) | Print every available agent, skill, reference, output, and stack baseline |
| [`export`](#export) | Build one self-contained Markdown bundle from selected roles and references |
| [`hook`](#hook) | Run and inspect lifecycle hooks |
| [`next` / `decide`](#next-and-decide) | See what's waiting, and answer checkpoints |
| [`action` / `decision` / `execution`](#action-and-decision-management) | Start, complete, and recover saved work; mostly run by agents |
| [`worktree`](#worktree) | List and clean up worktrees made by the Git workflow hooks |

## init

```bash
spec-lite init
spec-lite init --ai codex,copilot --exclude yolo --force
spec-lite init --ai codex,claude-code --skip-profile --force
```

Writes the current v2 configuration, provider-specific outputs, shared
root-instruction blocks, selected stack baselines, and an optional memory seed.

| Option | Default | Summary |
|---|---|---|
| `--ai <provider>` | detected / interactively selected | Configure `copilot`, `claude-code`, `codex`, `pi`, or `generic`; repeat the option or pass comma-separated values |
| `--exclude <names>` | none | Exclude comma/space-separated source names; hyphen and underscore forms are accepted |
| `--force` | `false` | Overwrite existing generated files without prompting |
| `--skip-profile` | `false` | Skip project profile and documentation questions for scripting |
| `--skip-hooks` | `false` | Don't offer the optional hooks; they are also skipped when there is no terminal. Run [`hook setup`](#hook-setup-names) later |

`--skip-profile` uses documentation defaults of `docs`, `technical`, and
`updateWithDevelopment: false`. Explicit `--ai` values override harness
auto-detection.

## update

```bash
spec-lite update
spec-lite update --ai codex,claude-code
spec-lite update --force
```

| Option | Default | Summary |
|---|---|---|
| `--ai <provider>` | providers in `.spec-lite.json` | Update only the named provider(s); repeat or pass comma-separated values |
| `--force` | `false` | Overwrite Project Context edits and remove detected obsolete generated outputs without confirmation |
| `--skip-hooks` | `false` | Don't offer optional hooks this project hasn't decided on; they are also skipped when there is no terminal |

Update performs the complete project migration:

- refreshes all configured agents, skills, prompts, native skill
  references/assets, and shared root-instruction blocks;
- preselects newly shipped sources so accepting the defaults installs them;
- updates `.spec-lite.json` to the current version and `format: "v2"`, adds
  `providers`, and collects the `documentation` section when it is missing;
- offers newly detected but unconfigured harnesses as opt-in providers;
- restores missing selected stack baselines without overwriting edited ones;
- detects obsolete v0.1.x outputs and asks before deleting them;
- migrates flat `.spec-lite/features/feature_<name>.md` specs into ID-prefixed
  directories, preserving both canonical `FEAT-###` and legacy Plan Feature
  `FEAT-FP-###` IDs and rewriting plan and feature-summary links;
- adds `requires` to hooks in `.spec-lite/hooks.json` and `~/.spec-lite/hooks.json`
  that rely on `${feature.*}` or `${changes.*}` where `implement.pre`,
  `implement.post`, `implement.task.post`, or `fix.post` no longer promise them,
  so they keep running in Feature Mode instead of failing validation (see
  [Hooks that need a feature](features/hooks.md#hooks-that-need-a-feature-or-a-change));
- preserves content inside Project Context markers unless `--force` is used.

## install

```bash
spec-lite install --global
spec-lite install --global --ai codex,claude-code,copilot,pi
spec-lite install --global --ai codex --exclude yolo --force
```

| Option | Default | Summary |
|---|---|---|
| `--global` | `false` | Required by `install`; selects user-level installation |
| `--ai <provider>` | interactive | Install for one or more globally supported providers |
| `--exclude <names>` | none | Omit comma/space-separated sources from the global installation |
| `--force` | `false` | Overwrite an existing global installation without confirmation |

A global install also adds `requires` to hooks in `~/.spec-lite/hooks.json`
that rely on variables an event no longer promises, as `update` does.

## list

```bash
spec-lite list
```

No command-specific options.

## export

```bash
spec-lite export plan feature implement review
spec-lite export --all
spec-lite export --all --no-references -o prompts.md
spec-lite export review -o -
```

| Option or argument | Default | Summary |
|---|---|---|
| `[names...]` | interactive picker | Source names to export; hyphen and underscore forms are accepted |
| `--all` | `false` | Include all agents, skills, and references |
| `-o, --output <file>` | `spec-lite-prompts.md` | Write to a file; use `-` for stdout |
| `--no-references` | references included | Omit `help` and `orchestrator` when used with `--all` |

Without names or `--all`, Export opens the same grouped source picker used by
Update. The output contains a grouped table of contents, initialized Project
Context, inlined source-local references, rewritten cross-role links, and no YAML
frontmatter.

## hook

Run and inspect lifecycle hooks. Roles call `hook run` themselves at their
lifecycle points; the other subcommands are for writing, checking, and debugging
hooks. For concepts and worked examples, see [Hooks](features/hooks.md).

```text
spec-lite hook run <event> [options]
spec-lite hook list [--event <name>] [--all]
spec-lite hook enable <names...> [--global]
spec-lite hook disable <names...> [--global]
spec-lite hook setup [names...]
spec-lite hook events
spec-lite hook vars
spec-lite hook validate
spec-lite hook test <name> [options]
spec-lite hook recover <event-id> --generation <n> --mode <retry|stop|override> --reason <text> [--checks <names>]
```

| Subcommand | Behavior |
|---|---|
| [`run <event>`](#hook-run-event) | Fire one event, running every subscribed hook in order. Roles call it; you rarely need to |
| [`list`](#hook-list) | List resolved hooks after merging builtin → global → project |
| [`enable <names...>` / `disable <names...>`](#hook-enable--disable-names) | Change hooks' enabled state in the project or global registry |
| [`setup [names...]`](#hook-setup-names) | Enable or skip the optional hooks and answer their options |
| [`events`](#hook-events) | Print the full event catalog with emitted/planned status |
| [`vars`](#hook-vars) | Print the `${...}` interpolation variable table |
| [`validate`](#hook-validate) | Validate the merged registry: schema, event names, templates, ordering |
| [`test <name>`](#hook-test-name) | Run one hook on its own against a synthetic or supplied payload |
| [`recover <event-id>`](#action-and-decision-management) | Retry, stop, or override a blocked, paused, or interrupted event, on your instruction |

### hook run \<event\>

You rarely need this: roles run it at every lifecycle point. Use it to preview an
event, to fire events for work you do without an agent, or from CI. See
[Running hooks yourself](features/hooks.md#running-hooks-yourself).

```bash
spec-lite hook run implement.post --feature FEAT-012 --dry-run
spec-lite hook run fix.pre --payload name=auth-issue
spec-lite hook run fix.post --payload name=auth-issue --payload summary="Fix token refresh"
```

| Option | Default | Summary |
|---|---|---|
| `--feature <id>` | none | Feature ID, such as `FEAT-012` or legacy `FEAT-FP-007`; adds the feature directory, spec, and changeset to the payload |
| `--task <id>` | none | Task ID, such as `TASK-003` |
| `--payload <kv>` | none | Additional payload `key=value`; repeat for several. `plan=<file>`, `name=<fix name>`, `change=<change name>`, and `yolo=<Run ID>` choose the work for the [Git workflow hooks](features/hooks-git-workflow.md) |
| `--dry-run` | `false` | Resolve and print what would run, without running anything; `${env:...}` values are redacted, as they are in hook output and the audit log. Previews gates and checkpoints too |
| `--json` | `false` | Machine-readable report instead of the human summary |
| `--skip <name>` | none | Skip a hook for this call; repeat for several, or use `*` for all. `SPEC_LITE_SKIP_HOOKS` does the same for a whole process |
| `--run-id <id>` | generated | Reuse one `runId` across several `hook run` calls |
| `--tracked` | `false` | Run as a tracked role run, which saves IDs so the run can pause, hand off, and resume. The roles pass it; you don't need it |
| `--execution <id>`, `--action <id>`, `--parent <id>`, `--retry <event-id>` | none | Tracked runs only: the IDs a role carries from one event to the next |
| `--verbose` | `false` | Tracked runs only: include stored approval snapshots and options |

Without `--tracked`, a call is a manual run: it runs each hook once and can't
pause. An event with a gate, checkpoint, or hand-off hook needs a tracked run, so
a manual call stops with exit `2` and names the hooks, unless you add `--dry-run`
or `--skip` them. A hand-off hook in a manual run prints a
`SPEC-LITE-DIRECTIVE {...}` line instead of saving an action.

When `prepare-worktree` runs, the CLI prints `SPEC-LITE-WORKTREE <json>`; use its
`path` for every later edit, test, and hook call. With `--json`, read
`payload.worktree`.

Exit codes are listed in [Results and exit codes](features/hooks.md#results-and-exit-codes):
`0` done (in a tracked run, also read the status), `1` a hook failed with
`onFailure: "abort"`, `2` a contract error, `3` a gate blocked, `4` busy. Firing a
catalog event that nothing subscribes to is a no-op with exit `0`.

### hook list

```bash
spec-lite hook list
spec-lite hook list --all
spec-lite hook list --event implement.post
```

| Option | Default | Summary |
|---|---|---|
| `--event <name>` | all | Show only hooks subscribed to this concrete event |
| `--all` | `false` | Include disabled hooks and show their status |

Each entry shows the hook name, its provenance (`builtin`, `global`, `project`),
its type, and the events it subscribes to. Hooks disabled with
`"enabled": false` are omitted unless `--all` is supplied.

### hook enable / disable \<names...\>

```bash
spec-lite hook disable capture-changeset
spec-lite hook enable capture-changeset
spec-lite hook enable prepare-worktree commit-progress create-pull-request
spec-lite hook disable capture-baseline --global
```

| Option | Default | Summary |
|---|---|---|
| `--global` | `false` | Write `~/.spec-lite/hooks.json` using builtin/global definitions instead of writing the project registry |

Writes only the `enabled` value: on the hook's existing entry in that file, or as
a new `{ "name": …, "enabled": … }` entry that configures the hook an earlier
layer defines, so builtins keep receiving updates. Project entries take
precedence over global ones. Neither command runs the hook or changes the
repository-wide `hooks.enabled` switch.

Several names are changed together and validated as a whole, which the Git
workflow hooks need because they depend on each other.

Exits `2` without writing for an unknown name or malformed registry. Enabling
also validates the hook's events and templates, and the Git workflow rules
(dependencies, order, builtin `options`). Disabling refuses to leave a
hook without one it depends on. Use `hook list --all` to find
disabled hooks. Remove an entry from its registry file to inherit the earlier
layer's settings again.

### hook setup [names...]

```bash
spec-lite hook setup
spec-lite hook setup create-pull-request
```

Asks, for each optional hook (`prepare-worktree`, `commit-progress`,
`create-pull-request`), whether to enable it, and for the options it needs, with
your current answers as defaults. A hook that needs one you skipped is recorded
as skipped without asking. Answers are saved as short entries in
`.spec-lite/hooks.json`; an entry you defined in full (with `type`) is left alone.
Nothing is saved if the result would fail validation.

`init` runs the same questions, and `update` runs them for optional hooks the
project hasn't decided on yet. Exits `2` for an unknown hook name or when the
result can't be saved.

### hook events

```bash
spec-lite hook events
```

Prints every event in the catalog with its emitting role, phase, and whether it
is `emitted` today or `planned` for a later release. No options.

### hook vars

```bash
spec-lite hook vars
```

Prints every `${...}` variable grouped by the guarantee group that supplies it,
with a description and an example value, and notes where `${env:NAME}` is
allowed. No options.

### hook validate

```bash
spec-lite hook validate
```

Static check of the merged registry with no side effects: JSON schema, event
names, every `${...}` template against the variables its subscribed events
guarantee (plus the groups the hook lists in `requires`), `${env:...}` used only
in `run`, `cwd`, `env`, `url`, `headers`, and `bodyTemplate`, builtin options,
and ordering rules, such as gates before hooks that change things, and one
hand-off or checkpoint per event. Each error names the hook and, for a template,
the field. An `${env:...}` variable that isn't set in the current shell is a
warning, since hooks may run elsewhere. Exits `0` when
valid (warnings allowed) and `2` when any error is found. Suitable for CI. No
options.

### hook test \<name\>

```bash
spec-lite hook test notify-slack
spec-lite hook test lint-after-implement --feature FEAT-012
spec-lite hook test notify-slack --event review.verdict --payload ./payload.json
```

| Option | Default | Summary |
|---|---|---|
| `--event <name>` | the hook's first subscribed event | Event to simulate |
| `--payload <file>` | none | JSON file whose top-level keys become payload values |
| `--feature <id>` | none | Feature ID, such as `FEAT-012` |
| `--task <id>` | none | Task ID, such as `TASK-003` |
| `--tracked`, `--execution <id>`, `--action <id>`, `--parent <id>` | none | Test a hook inside a tracked run |
| `--publish` | `false` | Confirm real publication when testing a checkpoint with `github` options |

`hook test` runs the real hook: a `command` hook really executes and an `http`
hook really posts. Use `hook run --dry-run` to see resolution without side
effects.

Gates and checkpoints only run inside a tracked role run, so preview them with
`hook run <event> --dry-run` instead. To try a gate's script, run it directly
with `SPEC_LITE_RESPONSE_FILE` set to a scratch file. Testing a checkpoint with
`github` options needs `--publish`, because it posts real content; prefer a
disposable repository.

## next and decide

The commands for [checkpoints](features/hooks-gates-checkpoints.md#checkpoints):
`next` shows what's waiting, and `decide` answers a question. Usually the agent
shows you the question in chat and runs `decide` for you; use these yourself to
answer from another terminal or to check on paused work.

```text
spec-lite next [<decision-id>] [--wait <duration>] [--all] [--json] [--verbose]
spec-lite decide <decision-id> <choice> [--feedback <text> | --feedback-file <path>]
```

```bash
spec-lite next
spec-lite decide d-0123456789 critique --feedback "focus on the data model"
spec-lite next d-0123456789 --wait 60s
```

| Command | Behavior |
|---|---|
| `next` | Lists waiting questions, ready actions, blocked gates, and paused or interrupted runs, each with the command that moves it on. Collects eligible GitHub replies. Never starts, answers, or uses up anything |
| `next <decision-id>` | Shows one question and its state |
| `next <decision-id> --wait <duration>` | Waits for an answer for up to the given time, at most `60s`. A timeout leaves the question pending |
| `next --all` | Also lists finished history: answered, expired, cancelled, and superseded questions |
| `decide <decision-id> <choice>` | Records your answer. It doesn't start the work; the agent picks it up when it next checks. `--feedback` or `--feedback-file` adds free-text feedback |

A GitHub reply can't restart a closed agent session: it's recorded, and it takes
effect when a session next checks. See
[Waiting and resuming](features/hooks-gates-checkpoints.md#waiting-and-resuming).

## action and decision management

These commands move saved work forward or recover it. Agents run the `action`
commands as part of a run. Run the recovery commands, or let the agent run them,
only when you decide to: each needs a `--reason`, which is recorded, and the
`--generation` that `spec-lite next` shows, which rejects a command based on an
out-of-date view.

```text
spec-lite action start <id> [--execution <origin-id>]
spec-lite action complete <id> --execution <id> --outcome <success|failed|stopped>
spec-lite action recover <id> --generation <n> --mode <retry|stop> --reason <text>
spec-lite execution recover <id> --generation <n> --mode <resume|stop> --reason <text>
spec-lite decision cancel <id> --reason <text>
spec-lite decision reissue <id> --reason <text>
spec-lite hook recover <event-id> --generation <n> --mode <retry|stop|override> --reason <text> [--checks <names>]
```

| Command | Use it when |
|---|---|
| `action start` | Starting a chosen action: continue, stop, or a target outside spec-lite. A spec-lite role starts with the `hook run <role>.pre --tracked --action <id>` command the result shows instead |
| `action complete` | A target outside spec-lite finished; records its outcome. spec-lite roles record completion themselves |
| `action recover` | A started action was interrupted: `retry` or `stop` it |
| `execution recover` | The agent's session ended mid-run: `resume` returns the run's IDs to a new session; `stop` frees the work to start again. Stop the old session first |
| `decision cancel` | Withdraw a question. The run stays paused until you reissue it or stop |
| `decision reissue` | Ask a question again with a new ID, after it expired or its files changed |
| `hook recover` | A gate used all its rounds (`retry`, `stop`, or `override --checks <gates>`), a chain paused, or a hook was cut off mid-way (`retry` or `stop`). An override is recorded as such, never as a pass |

Saved state lives in Git's internal directory, shared by the clone's worktrees,
never committed or packaged. Finished workflows are pruned after 30 days. See
[When something is stuck](features/hooks-gates-checkpoints.md#when-something-is-stuck)
and [Under the hood](features/hooks-gates-checkpoints.md#under-the-hood).

## worktree

List and clean up the worktrees made by the [Git workflow hooks](features/hooks-git-workflow.md).

```text
spec-lite worktree list [--json]
spec-lite worktree cleanup <name>
spec-lite worktree cleanup --merged
```

| Subcommand | Behavior |
|---|---|
| `list` | Each workflow's name, scope (`feature:FEAT-020`, `plan:orders`, `change:add-json-flag`, …), branch, path, and status: `active`, `no worktree`, or `incomplete` |
| `cleanup <name>` | After merging: verify the merge, remove the worktree (never forced), delete the local branch, reset specs copied from the main checkout, and forget the workflow |
| `cleanup --merged` | Clean up every merged workflow and report the rest as skipped |

Run `cleanup` from the main checkout, before `git pull`. It removes nothing
unless the branch is merged into `targetBranch` (or `fromBranch`), or the PR
provider reports that exact commit merged (squash merges). Exits `1` when it
refuses or Git fails, `2` for invalid arguments.
