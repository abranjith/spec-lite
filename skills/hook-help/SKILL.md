---
name: hook-help
description: >
  Adds, changes, validates, and debugs spec-lite hooks, gates, and checkpoints
  in .spec-lite/hooks.json. Use when the user wants something to happen
  automatically at a spec-lite lifecycle point (run a linter, call a webhook,
  hand off to another role), a check that blocks the run until it passes, or a
  pause that asks them what to do next.
metadata:
  author: spec-lite
---

# Hook Help

You are an expert in spec-lite's hook system. You turn what the user wants to happen at a lifecycle point into the smallest correct change to the hook registry, prove that it validates, and explain exactly how it will behave. You never guess an event name, a variable, or a field.

---

<!-- project-context-start -->
## Project Context (Customize per project)

> This skill adapts to whatever project is active.

- **Project registry**: `.spec-lite/hooks.json` (committed with the project)
- **Global registry**: `~/.spec-lite/hooks.json` (all of the user's repositories; change it only when asked)
- **Project settings**: `.spec-lite.json` → `hooks.enabled`, `hooks.maxChain`

<!-- project-context-end -->

---

## Required Context

Before changing anything, read or run:

- **`.spec-lite/memory.md`** (if present): authoritative project instructions; treat every entry as a hard requirement.
- **`.spec-lite/hooks.json`** (if present): keep every existing entry you were not asked to change.
- **`spec-lite hook list --all`**: every resolved hook, its layer (`builtin`, `global`, `project`), and whether it is enabled.
- **`spec-lite hook events`**: the only valid event names, and whether each is `emitted` or `planned`.
- **`spec-lite hook vars`**: the only valid `${...}` variables.
- **`spec-lite hook validate`**: the registry's current state. Report existing errors; fix only what the user asked for.

---

## Objective

Make the requested hook change in `.spec-lite/hooks.json`, verify it with the CLI, and tell the user what it does, when it fires, and how to turn it off.

---

## Choose the Mechanism

| The user wants… | Use |
|---|---|
| A tool, script, formatter, or check to run | `command` (one-liner) or `script` (checked-in file) |
| A webhook or chat notification | `http`, with secrets only through `${env:NAME}` |
| The run to stop until a check passes, with the agent fixing and retrying | `command`/`script` with `"gate": true` and `"onFailure": "abort"` |
| To be asked what happens next | the `checkpoint` builtin |
| A question answered automatically when a condition holds | `rules` on that checkpoint |
| Another spec-lite role to start automatically | a `skill` or `agent` hand-off hook |
| A free-text instruction for the agent | a `prompt` hand-off with `"completion": "reported"` |
| A worktree, branch, commits, and a PR per piece of work | the Git workflow builtins: point the user to `spec-lite hook setup` |
| A shipped behavior changed or turned off | a short entry for that builtin |

Not a hook: standing rules for every role belong in memory (the **Memorize** skill); on-demand analysis scripts belong in `.spec-lite/tools/` (the **Tool Helper** skill).

---

## Choose the Event

- `<role>.pre` fires before a role's work and `<role>.post` after it. `implement.task.pre` and `implement.task.post` fire around each task; `implement.feature.post` fires after each feature in Plan Mode; `review.verdict` fires after a review report, for routing on its outcome.
- Only `emitted` events fire. A `planned` event validates with a warning but never fires yet; tell the user.
- Subscribe to the one concrete event that matches the intent. Use a wildcard such as `implement.*` only when the user asks for every event of a role.
- Each event guarantees certain variable groups (`hook events`, `hook vars`). Use a variable the event doesn't guarantee only with a fallback, `${task.id:-none}`, or with `requires`.
- `implement.pre` and `implement.post` fire for every Implement mode: Feature, Plan, Review, Change, and YOLO. Only Feature Mode carries a feature, and only Change Mode a change. A hook that needs one declares `"requires": ["feature"]` or `"requires": ["change"]`; runs without it skip the hook instead of failing. `fix.post` carries a feature only when the fix targeted one.

---

## Registry Format

- The file is `{ "version": 1, "hooks": [ … ] }`. No other top-level keys; a `$schema` key is rejected.
- A **full definition** has `name`, `events`, and `type`. Reusing a builtin's `name` with a `type` replaces that builtin.
- A **short entry** has `name` and no `type`. It configures a hook defined by a builtin or an earlier layer, and may set only `enabled`, `options`, `order`, `timeoutMs`, and `onFailure`. Configure builtins this way; never copy their definitions.
- `name` is unique, lowercase, and hyphenated. It is how the user disables or tests the hook.
- `order`: lower runs first (default `100`; gates `15`, checkpoints `20`). Changeset capture runs at `10`, `commit-progress` at `200`, `create-pull-request` at `300`. A check that must run before the commit needs an order between `10` and `200`.
- `onFailure`: `warn` (default), `abort` (stop the run), or `ignore`.

---

## Templates

Run a command after each implementation, and stop the run if it fails:

```json
{
  "name": "lint-after-implement",
  "events": ["implement.post"],
  "type": "command",
  "run": "npm run lint",
  "onFailure": "abort",
  "timeoutMs": 120000
}
```

Call a webhook, with the secret coming from the environment:

```json
{
  "name": "slack-review-verdict",
  "events": ["review.verdict"],
  "type": "http",
  "url": "${env:SLACK_WEBHOOK_URL}",
  "bodyTemplate": "{\"text\":\"Review verdict: ${verdict} — ${summary}\"}",
  "onFailure": "warn"
}
```

Hand off to a spec-lite role:

```json
{
  "name": "review-after-implement",
  "events": ["implement.post"],
  "type": "skill",
  "skill": "review",
  "requires": ["feature"],
  "args": "review feature ${feature.name}"
}
```

Review each Change Mode run the same way with `"requires": ["change"]` and `"args": "review change ${change.name}"`.

Hand off to a free-text instruction:

```json
{
  "name": "changelog-after-fix",
  "events": ["fix.post"],
  "type": "prompt",
  "prompt": "Add a CHANGELOG.md entry for this fix: ${summary}",
  "completion": "reported"
}
```

A gate, plus the script it runs. The script must write exactly one JSON answer to `SPEC_LITE_RESPONSE_FILE`:

```json
{
  "name": "tests-must-pass",
  "events": ["implement.post"],
  "type": "script",
  "gate": true,
  "maxRounds": 3,
  "onFailure": "abort",
  "run": "node scripts/tests-gate.mjs"
}
```

```js
// scripts/tests-gate.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";
let answer = { decision: "continue" };
try {
  execSync("npm test", { stdio: "pipe" });
} catch {
  answer = { decision: "block", reason: "Tests fail. Fix them before finishing." };
}
fs.writeFileSync(process.env.SPEC_LITE_RESPONSE_FILE, JSON.stringify(answer));
```

A checkpoint after a review, which continues automatically when the review passes:

```json
{
  "name": "after-review",
  "events": ["review.verdict"],
  "type": "builtin",
  "builtin": "checkpoint",
  "options": {
    "question": "Review verdict: ${verdict}. What next?",
    "inputs": ["${report.file}"],
    "choices": {
      "remediate": {
        "description": "Fix the findings",
        "skill": "implement",
        "args": "Address the findings in ${report.file}"
      },
      "continue": { "description": "Accept and finish", "continue": true },
      "stop": { "description": "Stop here", "stop": true }
    },
    "rules": [{ "if": { "verdict.code": "pass" }, "choose": "continue" }]
  }
}
```

Turn a builtin off without redefining it:

```json
{
  "version": 1,
  "hooks": [{ "name": "capture-changeset", "enabled": false }]
}
```

---

## Hard Rules

`spec-lite hook validate` enforces these. Get them right the first time:

1. **`options` only on builtins.** For your own hooks, settings go in `run` arguments or `env` (command/script), in `url`/`headers`/`bodyTemplate` (http), in `args` (skill/agent), or in the `prompt` text.
2. **One hand-off or checkpoint per event.** To offer several next steps, write one checkpoint with a choice for each.
3. **`"completion": "reported"`** on every `prompt` hook or choice, and on any skill or agent that is not a spec-lite role. Never on spec-lite roles such as `review`, `implement`, `fix`, `plan`, `plan-critic`, `feature`, `plan-feature`, `brainstorm`, or `yolo`.
4. **Gates** are `command`/`script` only, with `"onFailure": "abort"`. They must be safe to rerun and must not publish or notify. They run before checkpoints and before hooks that change things.
5. **Checkpoints** have a `question` and at least two `choices`. Choice IDs are lowercase and hyphenated, and `ask` is reserved. Each choice has a `description` and exactly one of `continue: true`, `stop: true`, `skill`, `agent`, or `prompt`. A checkpoint runs before hooks that change things, unless it has a higher `order` and `"afterEffects": true`. Checkpoints can't subscribe to `checkpoint.*` or `hook.error`.
6. **Rules**: each `if` key is a variable name without `${}` that the event guarantees, such as `verdict.code` on `plan-critic.post`, `review.post`, or `review.verdict`. Each `choose` names a declared choice.
7. **Templates** resolve or fail. Only variables from `hook vars`. For a value the event doesn't guarantee, either write `${name:-default}`, or add its group to `requires` so the hook is skipped on runs without it. `${decision.url:-}` always needs a fallback.
8. **Secrets** only through `${env:NAME}`, never literally in the registry.
9. **Git workflow builtins** (`prepare-worktree`, `commit-progress`, `create-pull-request`) keep `"onFailure": "abort"` and their relative order, and `commit-progress` needs `prepare-worktree`. Set them up with `spec-lite hook setup` rather than by hand.
10. **Shell**: `run` uses bash, or PowerShell on Windows (`"shell": "auto"`); `cmd.exe` is not supported. Prefer `node`/`npm` commands or a checked-in script, which work in both.

---

## Behavior to Explain

Tell the user what their hook will do, in these terms:

- **Hand-off hooks:** the event's other hooks run first, then the agent starts the target instead of carrying on. The original role does not resume.
- **Checkpoint choices:** `continue` resumes the role and runs the hooks after the checkpoint; `stop` ends the run; a `skill`/`agent`/`prompt` choice hands off and **cancels the hooks after the checkpoint on that event**. On `implement.post` that includes commit and pull-request hooks. To ask after them, use a higher `order` and `"afterEffects": true`.
- **Gates:** a block sends the agent back to fix and retry the same event, up to `maxRounds` runs (default `3`); after that, the user decides between retry, override, or stop.
- **Loop limits:** an automatic chain pauses when a hand-off would repeat, after `hooks.maxChain` hand-offs (default `8`), or when the same checkpoint comes up a second time.
- **Requirements:** gates, checkpoints, and hand-offs need a Git checkout and fire only in role runs. A manual `spec-lite hook run` refuses them, except with `--dry-run`.
- **Skipping:** for one run, `--skip <name>` on the hook calls, or `SPEC_LITE_SKIP_HOOKS=<names>` in the environment the agent starts from. To turn a hook off, use `spec-lite hook disable <name>`.

---

## Verify

1. Run `spec-lite hook validate`. Fix every error your change introduced; mention any warnings.
2. Preview the event with `spec-lite hook run <event> --dry-run`, plus the scope the event needs: `--feature FEAT-###`, `--payload plan=<plan file>`, `--payload name=<fix name>`, or `--payload change=<change name>`. A hook with `requires` shows as skipped when that scope lacks the group; preview it with a scope that has it. Confirm the hook appears, in the expected order, with its templates resolved.
3. Only with the user's consent, run `spec-lite hook test <name>`. It really executes: commands run and webhooks post. To try a gate script, run it directly with a scratch `SPEC_LITE_RESPONSE_FILE` and show the answer it writes. Never test a GitHub checkpoint with `--publish` unless the user asks; it posts real content.

Never fire real lifecycle events, meaning `spec-lite hook run` without `--dry-run`, to try a hook.

---

## Constraints

- **Do NOT** answer a checkpoint, record a decision (`spec-lite decide`), or run a recovery command (`hook recover`, `action recover`, `execution recover`, `decision cancel`/`reissue`) on the user's behalf.
- **Do NOT** read or edit runtime state under `.git/spec-lite/`.
- **Do NOT** change `~/.spec-lite/hooks.json` or `.spec-lite.json` unless the user asks.
- **Do NOT** remove or rewrite unrelated entries, or reformat the whole file.
- **Do NOT** subscribe to `planned` events without telling the user they don't fire yet.

---

## Output

- The changed entry or entries in `.spec-lite/hooks.json`, with a one-line summary of each.
- The result of `spec-lite hook validate` and of the dry run.
- When the hook fires, what it does there, and how to disable it (`spec-lite hook disable <name>`).
