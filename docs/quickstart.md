# Quickstart

Install once, then initialize each repository you work in. Reusable roles live in
your harness's global directories; working state lives in the repository.

Requires **Node.js 22 or newer** (current LTS).

## 1. Install the CLI and the roles

```bash
npm install -g @abranjith/spec-lite
spec-lite install --global --ai codex,claude-code,copilot,pi
```

Omit `--ai` to choose providers interactively. To refresh a global installation
after upgrading the npm package, rerun the command with `--force`.

This is the recommended setup: the agents and skills become available in every
workspace, while their working state stays local to each project.

## 2. Initialize a repository

```bash
cd your-project
spec-lite init
```

Harness detection preselects likely providers, and setup records the project
profile and documentation preferences in `.spec-lite.json`.

For automation:

```bash
spec-lite init --ai codex,claude-code --skip-profile --force
```

`--skip-profile` uses documentation defaults of `docs`, `technical`, and
`updateWithDevelopment: false`.

Explicit `--ai` values override harness auto-detection. Configure several
providers by repeating the option or passing comma-separated values:

```bash
spec-lite init --ai copilot --ai codex
spec-lite init --ai claude-code,codex,pi
```

## 3. Run a first workflow

Select the role in your harness and send it a short prompt. For a new project:

```text
Brainstorm → Plan → Feature × N → Implement → Review → Integration Tests → Document
```

| Step | Select | Say something like |
|---|---|---|
| 1 | `spec.brainstormer` | "Turn this shared grocery-list idea into a concise product vision." |
| 2 | `spec.planner` | "Plan the app from `.spec-lite/brainstorm.md` using TypeScript, React, and PostgreSQL." |
| 3 | `spec-feature` | "Create feature specs for every incomplete feature in `.spec-lite/plan.md`." |
| 4 | `spec-implement` | "Implement `.spec-lite/features/FEAT-001-shared_lists/spec.md` and verify every task." |
| 5 | `spec-review` | "Review feature `shared_lists` after implementation." |

Shorter paths are usually enough:

| Situation | Suggested workflow |
|---|---|
| Clear idea for a new project | Plan → Feature → Implement → Review |
| One focused enhancement | Feature Planner → Implement → Review → Document Update |
| Existing defect or refactor | Fix → Review |
| Architecture decision | Architect, then Plan or DevOps |
| Existing plan needs a challenge | Plan Critic → revise or continue |
| Well-scoped autonomous build | YOLO |

See [Agents and skills](features/agents-and-skills.md) for the full catalog, how
to select a role in each harness, and example prompts for every role.

## 4. Commit the project state

After the first useful artifact is created, commit it so teammates and other
harnesses can resume from the same decisions:

```bash
git add .spec-lite .spec-lite.json
git commit -m "Add shared spec-lite project context"
```

Provider-specific project files such as `AGENTS.md`, `CLAUDE.md`, `.github/`,
`.codex/`, `.agents/`, and `.pi/` can also be committed when the team uses those
harnesses.

## 5. Switch harnesses mid-feature

A handoff does not depend on copying a chat transcript. Each role reads the
relevant repository artifacts again:

1. Use `spec.brainstormer` in Claude Code to write `.spec-lite/brainstorm.md`.
2. Open the same repository in Codex and use `spec.planner`; it reads the
   brainstorm and shared memory, then writes `.spec-lite/plan.md`.
3. Use the `spec-feature` skill in Pi to create a feature spec under
   `.spec-lite/features/`.
4. Switch to Copilot and use `spec-implement`; it reads the plan, feature spec,
   memory, and current code before implementing.
5. Commit the updated `.spec-lite/` state with the code so another teammate — or
   a different harness — can run Review without losing decisions or scope.

## Next steps

- [Agents and skills](features/agents-and-skills.md) — the catalog and how to select roles
- [CLI reference](usage.md) — every command and option
- [Architecture](architecture.md) — how the pieces fit together
- [Memory and project state](features/memory.md) — what to commit and why
- [Hooks](features/hooks.md) — run your own automation at lifecycle points
