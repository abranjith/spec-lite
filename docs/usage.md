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

Update performs the complete project migration:

- refreshes all configured agents, skills, prompts, native skill
  references/assets, and shared root-instruction blocks;
- preselects newly shipped sources so accepting the defaults installs them;
- updates `.spec-lite.json` to the current version and `format: "v2"`, adds
  `providers`, and collects the `documentation` section when it is missing;
- offers newly detected but unconfigured harnesses as opt-in providers;
- restores missing selected stack baselines without overwriting edited ones;
- detects obsolete v0.1.x outputs and asks before deleting them;
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
spec-lite hook list [--event <name>]
spec-lite hook events
spec-lite hook vars
spec-lite hook validate
spec-lite hook test <name> [options]
```

| Subcommand | Behavior |
|---|---|
| [`run <event>`](#hook-run-event) | Fire one event, dispatching every subscribed hook in order |
| [`list`](#hook-list) | List resolved hooks after merging builtin → global → project |
| [`events`](#hook-events) | Print the full event catalog with emitted/planned status |
| [`vars`](#hook-vars) | Print the `${...}` interpolation variable table |
| [`validate`](#hook-validate) | Validate the merged registry — schema, event names, templates |
| [`test <name>`](#hook-test-name) | Run one hook in isolation against a synthetic or supplied payload |

### hook run \<event\>

```bash
spec-lite hook run implement.post --feature FEAT-012 --payload summary="Added expiry"
spec-lite hook run implement.post --feature FEAT-012 --dry-run
spec-lite hook run review.verdict --payload verdict="Request changes" --json
```

| Option | Default | Summary |
|---|---|---|
| `--feature <id>` | none | Feature ID, e.g. `FEAT-012`; resolves the feature directory, spec, and changeset into the payload |
| `--task <id>` | none | Task ID, e.g. `TASK-003` |
| `--payload <kv>` | none | Additional payload `key=value`; repeat for several (`--payload summary=... --payload verdict=...`) |
| `--run-id <id>` | generated | Reuse one `runId` across multiple `hook run` calls |
| `--dry-run` | `false` | Resolve and print what would run, without executing; `${env:...}` values are redacted |
| `--json` | `false` | Machine-readable report on stdout instead of the human summary |

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

### hook list

```bash
spec-lite hook list
spec-lite hook list --event implement.post
```

| Option | Default | Summary |
|---|---|---|
| `--event <name>` | all | Show only hooks subscribed to this concrete event |

Each entry shows the hook name, its provenance (`builtin`, `global`, `project`),
its type, and the events it subscribes to. Hooks disabled with
`"enabled": false` are omitted.

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
