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
| [`next` / `decide`](#next-and-decide) | Inspect durable checkpoints and record user choices |
| [`action` / `decision`](#action-and-decision-management) | Acknowledge and recover saved workflow actions |
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
lifecycle points; the other subcommands are for authoring and debugging your own
hooks. For concepts and worked examples see [Hooks](features/hooks.md).

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
```

| Subcommand | Behavior |
|---|---|
| [`run <event>`](#hook-run-event) | Fire one event, dispatching every subscribed hook in order |
| [`list`](#hook-list) | List resolved hooks after merging builtin → global → project |
| [`enable <names...>` / `disable <names...>`](#hook-enable--disable-names) | Change hooks' enabled state in the project or global registry |
| [`setup [names...]`](#hook-setup-names) | Enable or skip the optional hooks and answer their options |
| [`events`](#hook-events) | Print the full event catalog with emitted/planned status |
| [`vars`](#hook-vars) | Print the `${...}` interpolation variable table |
| [`validate`](#hook-validate) | Validate the merged registry — schema, event names, templates |
| [`test <name>`](#hook-test-name) | Run one hook in isolation against a synthetic or supplied payload |

### hook run \<event\>

Updated role prompts use `--protocol 2`, keep `--execution <id>` and optional `--action <id>` after pre, and use `--parent <id>` for fresh delegates. Gate retries use the returned `--retry <event-id>`. Resolve root work with feature, plan, fix name, review scope, artifact or YOLO ID. Legacy examples below remain stateless; a gate/checkpoint requires protocol 2. See [next and decide](#next-and-decide).

```bash
spec-lite hook run implement.post --feature FEAT-012 --payload summary="Added expiry"
spec-lite hook run implement.post --feature FEAT-012 --dry-run
spec-lite hook run review.verdict --payload verdict="Request changes" --json
```

| Option | Default | Summary |
|---|---|---|
| `--feature <id>` | none | Feature ID, e.g. `FEAT-012` or legacy `FEAT-FP-007`; resolves the feature directory, spec, and changeset into the payload |
| `--task <id>` | none | Task ID, e.g. `TASK-003` |
| `--payload <kv>` | none | Additional payload `key=value`; repeat for several (`--payload summary=... --payload verdict=...`) |
| `--run-id <id>` | generated | Reuse one `runId` across multiple `hook run` calls |
| `--dry-run` | `false` | Resolve and print what would run, without executing; `${env:...}` values are redacted |
| `--json` | `false` | Machine-readable report on stdout instead of the human summary |
| `--skip <name>` | none | Suppress a hook for this invocation; repeat for multiple names or use `*` for all |

Exit codes: `0` success (including failures policied `warn`/`ignore`), `1` a hook
with `onFailure: "abort"` failed, `2` a contract error — the event name is not in
the catalog, the registry failed validation, a `${...}` reference had no value,
or the payload failed a hook's `payloadSchema`. Firing a catalog event that
nothing subscribes to is a no-op with exit `0`.

Agentic hooks (`skill`, `agent`, `prompt`) are never executed. They print a
`SPEC-LITE-DIRECTIVE` line for the calling role to carry out:

```text
  ✓ review-after-implement (skill) [emitted]
    SPEC-LITE-DIRECTIVE {"hook":"review-after-implement","type":"skill","event":"implement.post","skill":"spec-review","args":"review feature user_management"}
```

`SPEC_LITE_SKIP_HOOKS` accepts comma-separated names for process-scoped
suppression. When `prepare-worktree` runs, the CLI prints
`SPEC-LITE-WORKTREE <json>`; use its `path` for every later edit, test, and hook
call. With `--json`, read `payload.worktree`. The Git workflow hooks also read
`--payload name=…`, `--payload plan=<plan file>`, and `--payload yolo=<Run ID>`
to choose the workflow. See [Git workflow hooks](features/hooks.md#git-workflow-hooks)
for setup, provider requirements, and retry behavior.

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
with a description and an example value. No options.

### hook validate

```bash
spec-lite hook validate
```

Static check of the merged registry with no side effects: JSON schema, event
names, and every `${...}` template against the variables its subscribed events
guarantee. Exits `0` when valid (warnings allowed) and `2` when any error is
found. Suitable for CI. No options.

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
| `--feature <id>` | none | Feature ID, e.g. `FEAT-012` |
| `--task <id>` | none | Task ID, e.g. `TASK-003` |

`hook test` runs the real executor — a `command` hook really executes and an
`http` hook really posts. Use `hook run --dry-run` when you want resolution
without side effects.

Durable tests also accept `--protocol 2`, `--execution`, `--action` and `--parent`.
Checkpoint tests require explicit test scope/context; a post-event test first
needs a scoped pre event and its returned execution ID. Testing a configured
GitHub checkpoint also requires `--publish` because it creates real remote
content. Prefer a disposable test repository or a dry-run preview.

## next and decide

Durable control works through short CLI calls across providers. A checkpoint saves state and exits; the agent displays its choices and yields. See [Gates and checkpoints](features/hooks.md#gates-and-checkpoints).

```text
spec-lite next [<decision-id>] [--wait <duration>] [--all] [--json] [--verbose]
spec-lite decide <decision-id> <choice> [--feedback <text> | --feedback-file <path>]
```

`next` lists/inspects state, including running executions whose session may have ended, and can ingest authorized GitHub replies. `--all` adds terminal history; `--verbose` includes stored snapshots. It never chooses, consumes, starts or completes an action. `decide` records a user's actual selection, leaving delivery intact. Follow the returned start command before invoking the target.

Wait requires an ID and finite duration of at most 60 seconds, within the host's call budget. Timeout stays pending; repeated foreground waiting is not the default. Remote answers do not restart closed agent sessions.

Root `hook run --protocol 2` resolves scope before effects; later events retain its execution/action IDs. Delegates use `--parent <execution-id>`. An instrumented target acknowledges at its returned `.pre --action` command; external reported targets use `action start/complete`.

## action and decision management

```text
spec-lite action start <id> [--execution <origin-id>]
spec-lite action complete <id> --execution <id> --outcome <success|failed|stopped>
spec-lite action recover <id> --generation <n> --mode <retry|stop> --reason <text>
spec-lite execution recover <id> --generation <n> --mode <resume|stop> --reason <text>
spec-lite decision cancel <id> --reason <text>
spec-lite decision reissue <id> --reason <text>
spec-lite hook recover <event-id> --generation <n> --mode <retry|stop|override> --reason <text> [--checks <names>]
```

`action start` applies continue/stop controls or claims an external reported target; instrumented roles normally use their returned pre command. Continue resumes the event suffix, stop ends it, and a handoff replaces it without automatic return.

`action complete` records external completion without claiming independent verification. Instrumented completion must match the owning lifecycle context.

Cancel keeps the workflow paused. Reissue creates a new ID/snapshot and rejects running actions. Recovery needs an actual user instruction, current generation and reason; stop/reconcile an old executor before takeover. `execution recover` handles a role's own execution after its session ended: `resume` returns the context to carry, `stop` releases the scope. A named check override is distinct from a pass.

State is local to the clone and linked worktrees under the Git common directory, never committed or packaged; terminal workflows are pruned after 30 days. Outside a Git checkout, events with only stateless hooks run without durable context. Use `next` for exact IDs and recovery guidance rather than editing runtime files.

Protocol-2 exit codes: 0 valid result requiring status inspection, 1 operational/guard failure, 2 contract error, 3 blocked gate, 4 retryable busy. Timeout is a valid pending result. Existing authorization and permission settings still apply.

## worktree

List and clean up the worktrees made by the [Git workflow hooks](features/hooks.md#git-workflow-hooks).

```text
spec-lite worktree list [--json]
spec-lite worktree cleanup <name>
spec-lite worktree cleanup --merged
```

| Subcommand | Behavior |
|---|---|
| `list` | Each workflow's name, scope (`feature:FEAT-020`, `plan:orders`, …), branch, path, and status: `active`, `no worktree`, or `incomplete` |
| `cleanup <name>` | After merging: verify the merge, remove the worktree (never forced), delete the local branch, reset specs copied from the main checkout, and forget the workflow |
| `cleanup --merged` | Clean up every merged workflow and report the rest as skipped |

Run `cleanup` from the main checkout, before `git pull`. It removes nothing
unless the branch is merged into `targetBranch` (or `fromBranch`), or the PR
provider reports that exact commit merged (squash merges). Exits `1` when it
refuses or Git fails, `2` for invalid arguments.
