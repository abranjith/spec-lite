# spec-lite

Portable, structured software-engineering workflows for Codex, Claude Code, GitHub Copilot, Pi, and any LLM.

[![npm](https://img.shields.io/npm/v/@abranjith/spec-lite)](https://www.npmjs.com/package/@abranjith/spec-lite)
[![Test on PR](https://github.com/abranjith/spec-lite/actions/workflows/test.yml/badge.svg)](https://github.com/abranjith/spec-lite/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

spec-lite gives AI coding assistants the same focused agents, repeatable skills, and project context. The role definitions adapt to each harness, while plans, memory, feature specs, reviews, and documentation stay in the repository. Start work in Claude Code, continue it in Codex, review it in Copilot, or hand it to a teammate using Pi without rebuilding the context from scratch.

## Why spec-lite

Coding harnesses represent agents and skills differently. Their conversation history is also isolated, which makes changing tools mid-feature surprisingly expensive. spec-lite separates the reusable workflow from the local project state:

```text
Globally installed spec-lite agents and skills
        │
        ├── Codex
        ├── Claude Code
        ├── GitHub Copilot
        └── Pi
                │
                ▼
        The same project repository
                │
                ├── .spec-lite/memory.md
                ├── .spec-lite/plan*.md
                ├── .spec-lite/features/
                ├── .spec-lite/reviews/
                └── project documentation and code
```

The harness is the interface; the repository is the durable source of truth. Commit the `.spec-lite/` directory so teammates and different assistants can resume from the same decisions, task state, and review history.

## Highlights

- **Cross-harness continuity** — use the same project and feature state from Codex, Claude Code, Copilot, Pi, or exported Markdown prompts.
- **Global reusable roles, local durable state** — install agents and skills once, while each repository keeps its own memory, plans, features, reviews, and documentation.
- **Native provider adapters** — generates each harness's expected agent, command, prompt, skill, and root-instruction formats.
- **Modular delivery workflow** — use only the discovery, planning, implementation, testing, review, documentation, data, or DevOps role a task needs.
- **Consolidated review** — one deterministic review covers correctness, testing, security, and performance.
- **First-class documentation** — choose the documentation directory and depth, with optional updates during implementation and fixes.
- **Shared memory** — durable project conventions live in `.spec-lite/memory.md` and can be captured as the work evolves.
- **Stable feature IDs** — `FEAT-###` identifiers remain consistent across plans, feature specs, implementation, tests, and review.
- **14 stack baselines** — TypeScript, Python, Java, .NET, Go, Rust, Kotlin, Swift, C/C++, PHP, Ruby, React, Vue, and Angular.
- **Safe upgrades** — update every configured provider, preselect newly shipped roles, migrate config, preserve Project Context edits, and clean obsolete generated outputs with confirmation.
- **Portable export** — combine selected roles and references into one self-contained Markdown prompt for chat tools, teammates, or unsupported harnesses.

## Recommended Installation

Requires Node.js 20 or newer.

Install the CLI globally, then install the agents and skills globally for the harnesses you use. This is the recommended setup because the reusable roles become available in every workspace while their working state remains local to each project.

```bash
npm install -g @abranjith/spec-lite
spec-lite install --global --ai codex,claude-code,copilot,pi
```

Omit `--ai` to choose providers interactively. To refresh a global installation after upgrading the npm package, rerun the command with `--force`.

Then initialize each repository. Harness detection preselects likely providers and the setup records the project profile and documentation preferences in `.spec-lite.json`.

```bash
cd your-project
spec-lite init
```

For automation:

```bash
spec-lite init --ai codex,claude-code --skip-profile --force
```

`--skip-profile` uses documentation defaults of `docs`, `technical`, and `updateWithDevelopment: false`.

After the first useful artifact is created, commit the project state for portable, cross-team collaboration:

```bash
git add .spec-lite .spec-lite.json
git commit -m "Add shared spec-lite project context"
```

Provider-specific project files such as `AGENTS.md`, `CLAUDE.md`, `.github/`, `.codex/`, `.agents/`, and `.pi/` can also be committed when the team uses those harnesses.

## Supported Providers

| Provider | Project files | Global agent/skill folders |
|---|---|---|
| GitHub Copilot | `.github/agents/`, `.github/prompts/`, `.github/skills/`, `.github/copilot-instructions.md` | `~/.copilot/agents/`, `~/.copilot/prompts/`, `~/.copilot/skills/` |
| Claude Code | `.claude/agents/`, `.claude/commands/`, `CLAUDE.md` | `~/.claude/agents/`, `~/.claude/commands/` |
| OpenAI Codex | `.codex/agents/`, `.agents/skills/`, `AGENTS.md` | `~/.codex/agents/`, `~/.agents/skills/`, `~/.codex/AGENTS.md` |
| Pi | `.pi/prompts/`, `.pi/skills/` | `~/.pi/agent/prompts/`, `~/.pi/agent/skills/` |
| Generic | `.spec-lite/prompts/` for copy/paste into any LLM | Not supported; use `export` for a portable bundle |

Global installation state is recorded at `~/.spec-lite/global-config.json`. Project state remains in the repository.

Configure several providers for one project by repeating `--ai` or using comma-separated values:

```bash
spec-lite init --ai copilot --ai codex
spec-lite init --ai claude-code,codex,pi
```

Explicit `--ai` values override harness auto-detection.

## Workflow

Use the full flow for a new application:

```text
Brainstorm → Plan → Feature × N → Implement → Review → Integration Tests → Document
```

Common shorter paths are:

| Situation | Suggested workflow |
|---|---|
| Clear idea for a new project | Plan → Feature → Implement → Review |
| One focused enhancement | Feature Planner → Implement → Review → Document Update |
| Existing defect or refactor | Fix → Review |
| Architecture decision | Architect, then Plan or DevOps |
| Existing plan needs a challenge | Plan Critic → revise or continue |
| Well-scoped autonomous build | YOLO |

Review runs after code exists and always covers correctness, security, performance, and test gaps. Plan Critic is the separate pre-implementation checkpoint.

### Seamless handoff between harnesses

A handoff does not depend on copying a chat transcript. Each role reads the relevant repository artifacts again.

1. Use `spec.brainstormer` in Claude Code to write `.spec-lite/brainstorm.md`.
2. Open the same repository in Codex and use `spec.planner`; it reads the brainstorm and shared memory, then writes `.spec-lite/plan.md`.
3. Use the `spec-feature` skill in Pi to create a feature spec under `.spec-lite/features/`.
4. Switch to Copilot and use `spec-implement`; it reads the plan, feature spec, memory, and current code before implementing.
5. Commit the updated `.spec-lite/` state with the code so another teammate or harness can run Review without losing the decisions or scope.

## Agents and Skills

Agents are autonomous specialist personas. Skills are focused, repeatable workflows that can be auto-discovered or explicitly selected.

### Agents

| Source | Typical selector | Persona |
|---|---|---|
| `brainstorm` | `spec.brainstormer` | Curious product partner who turns a rough idea into a concrete, testable vision. |
| `plan` | `spec.planner` | Pragmatic technical planner who converts requirements into an implementation-ready blueprint. |
| `plan-feature` | `spec.feature_planner` | Focused feature designer who scopes one enhancement without requiring a full project plan. |
| `architect` | `spec.architect` | Systems architect who designs cloud topology, data strategy, reliability, and scale. |
| `yolo` | `spec.yolo` | Autonomous delivery coordinator who runs the full workflow with checkpoints and resumable state. |

### Skills

| Source | Native skill | Persona |
|---|---|---|
| `feature` | `spec-feature` | Decomposer who turns plan features into small, verifiable vertical slices. |
| `implement` | `spec-implement` | Disciplined implementation engineer who writes code, tests, and required documentation. |
| `review` | `spec-review` | Independent reviewer who checks correctness, security, performance, and testing in one pass. |
| `fix` | `spec-fix` | Methodical debugger and refactorer who proves root cause and guards against regression. |
| `write-unit-tests` | `spec-write-unit-tests` | Unit-test specialist who targets behavior, boundaries, errors, and exclusions. |
| `write-integration-tests` | `spec-write-integration-tests` | Integration-test specialist who verifies component seams and external boundaries. |
| `document` | `spec-document` | Documentation coordinator for full, targeted, and surgical updates. |
| `document-design` | `spec-document-design` | Architecture writer who documents the implemented design with verified diagrams. |
| `document-feature` | `spec-document-feature` | Feature writer who explains one implemented capability and its behavior. |
| `document-usage` | `spec-document-usage` | User-guide writer who creates verified quickstarts and usage documentation. |
| `document-readme` | `spec-document-readme` | Developer advocate who keeps the repository entry point accurate and inviting. |
| `memorize` | `spec-memorize` | Convention curator who maintains durable standing instructions and resolves conflicts explicitly. |
| `plan-critic` | `spec-plan-critic` | Skeptical preflight reviewer who pressure-tests feasibility, risk, quality, and adaptability. |
| `build-data-model` | `spec-build-data-model` | Relational data modeller who defines tables, relationships, constraints, and indexes. |
| `devops` | `spec-devops` | Production-minded platform engineer for CI/CD, containers, environments, and deployment. |
| `todo` | `spec-todo` | Backlog curator who records useful ideas without expanding the current task. |
| `tool-help` | `spec-tool-help` | Toolsmith who creates reusable project-analysis scripts for other roles. |

Two reference prompts are also included: `help` is the user-facing catalog, while `orchestrator` defines shared precedence, naming, feature-ID, memory, and handoff contracts.

### Selecting a role in each harness

| Harness | Agent selection | Skill selection |
|---|---|---|
| GitHub Copilot | Select `spec.<agent>` from the agent picker | Describe the task for auto-discovery, select the generated agent, or use the corresponding project prompt |
| Claude Code | Select `spec.<agent>`; project installs also provide `/spec.<verb>` commands | Select the generated specialist agent such as `spec.implementer` or use the project command |
| OpenAI Codex | Invoke the `spec.<agent>` subagent | Ask Codex to use the skill by name, such as `spec-implement` |
| Pi | Use `/spec.<verb>` | Use `/skill:spec-<name>` or allow Pi to auto-discover it |
| Generic | Open `.spec-lite/prompts/spec.<verb>.md` | Copy the matching prompt into the LLM, or create a combined bundle with `export` |

## Example Usage

Suppose you want to build a small shared grocery-list web app with real-time updates and email invitations. Select the named role in your harness, then send a short prompt like the one shown. These are examples, not a required checklist—use only the roles the work needs.

### Agent examples

| Select | Example prompt |
|---|---|
| `spec.brainstormer` | “Turn this shared grocery-list idea into a concise product vision. Focus on the smallest useful first release.” |
| `spec.planner` | “Plan the grocery-list app from `.spec-lite/brainstorm.md` using TypeScript, React, and PostgreSQL.” |
| `spec.feature_planner` | “Create one self-contained feature spec for inviting another person to a grocery list.” |
| `spec.architect` | “Design a low-cost production architecture for this app, including real-time updates, email delivery, backups, and scaling.” |
| `spec.yolo` | “Build the scoped MVP from the approved requirements. Stop at the defined checkpoints and keep resumable state.” |

### Skill examples

| Select or invoke | Example prompt |
|---|---|
| `spec-feature` | “Create feature specs for every incomplete feature in `.spec-lite/plan.md`.” |
| `spec-implement` | “Implement `.spec-lite/features/feature_shared_lists.md` and verify every task.” |
| `spec-review` | “Review feature `shared_lists` after implementation.” |
| `spec-fix` | “The second browser does not receive list updates. Diagnose the root cause, fix it, and add a regression test.” |
| `spec-write-unit-tests` | “Add unit tests for the invitation service, including expired, duplicate, and malformed tokens.” |
| `spec-write-integration-tests` | “Test the invitation flow across the API, database, email adapter, and acceptance endpoint.” |
| `spec-document` | “Update all configured documentation to match the implemented MVP.” |
| `spec-document-design` | “Document the current architecture and real-time update flow.” |
| `spec-document-feature` | “Document the implemented shared-list invitation feature.” |
| `spec-document-usage` | “Write a verified quickstart and user guide for creating and sharing a list.” |
| `spec-document-readme` | “Refresh the README with the working setup commands and current feature list.” |
| `spec-memorize` | “Remember that all timestamps use UTC and all API errors use the shared error envelope.” |
| `spec-plan-critic` | “Pressure-test `.spec-lite/plan.md` before implementation, especially the real-time sync and authorization design.” |
| `spec-build-data-model` | “Design the relational model for users, lists, memberships, items, invitations, and audit events.” |
| `spec-devops` | “Add Docker, CI, preview deployments, production secrets guidance, and database migration checks.” |
| `spec-todo` | “Add offline editing and push notifications to the product backlog without changing the current MVP.” |
| `spec-tool-help` | “Create a project tool that reports migration status and failed tests for use by other spec-lite roles.” |

## Review

Review accepts exactly one deterministic scope:

```text
review files <paths/globs>
review feature <name>
review plan [plan-file]
```

Feature and plan review use the `Touched Files` sections maintained during implementation. Every run produces one `.spec-lite/reviews/review_<scope>.md` report with `REV-###` findings, Critical/High/Medium/Low severity, remediation targets, and an approval verdict. Review recommends changes; use Fix or Implement Review Mode to apply them.

## Documentation

Initialization stores documentation behavior in `.spec-lite.json`:

```json
{
  "documentation": {
    "directory": "docs",
    "level": "technical",
    "updateWithDevelopment": true
  }
}
```

- `directory` is a repository-relative output path.
- `level` is `technical` or `full`.
- `updateWithDevelopment` makes Implement and Fix request a surgical documentation update after code changes.

Use `document` for the configured full set, `document update` after changes, or a targeted role such as `document architecture` or `document feature <name>`.

## Memory and Shared Project State

`.spec-lite/memory.md` is the authority for standing project instructions. Run `memorize bootstrap` to seed it from manifests, configuration, code patterns, stack guidance, and official documentation.

Planning and delivery roles may capture up to three durable conventions per run. Captured entries are date-tagged and reported; conflicts are never silently resolved. Use Memorize to override or reorganize instructions.

Recommended version-controlled state:

```text
.spec-lite/
├── memory.md                  Standing project conventions
├── brainstorm.md              Product discovery context
├── plan.md                    Default technical blueprint
├── plan_<name>.md             Optional named blueprint
├── features/                  Feature specs and task state
├── reviews/                   Plan and implementation reviews
├── stacks/                    Selected stack baselines
├── data_model.md              Relational model, when used
├── TODO.md                    Deferred enhancement backlog
├── yolo_state.md              Resumable autonomous-run state
└── tools/                     Project-specific context helpers
```

Commit these files with the related code. That makes decisions reviewable in pull requests and lets another developer—or a different AI harness—continue with the same state.

## CLI API Reference

The supported public API is the `spec-lite` command-line interface; the package does not currently expose a stable programmatic JavaScript API.

```text
spec-lite <command> [arguments] [options]
```

| Command | High-level behavior |
|---|---|
| `spec-lite init` | Detect providers, collect project/documentation settings, install selected roles locally, and create `.spec-lite.json`. |
| `spec-lite update` | Refresh configured project providers and config while preserving Project Context edits unless forced. |
| `spec-lite install --global` | Install reusable agents and skills in user-level harness directories. |
| `spec-lite list` | Print every available agent, skill, reference, output, and stack baseline. |
| `spec-lite export [names...]` | Build one self-contained Markdown bundle from selected roles and references. |

Every command supports `-h, --help`; the root command also supports `-V, --version`.

### Command options

| Command | Option or argument | Default | Summary |
|---|---|---|---|
| `init` | `--ai <provider>` | detected/interactively selected | Configure `copilot`, `claude-code`, `codex`, `pi`, or `generic`; repeat the option or pass comma-separated values. |
| `init` | `--exclude <names>` | none | Exclude comma/space-separated source names; hyphen and underscore forms are accepted. |
| `init` | `--force` | `false` | Overwrite existing generated files without prompting. |
| `init` | `--skip-profile` | `false` | Skip project profile and documentation questions for scripting. |
| `update` | `--ai <provider>` | providers in `.spec-lite.json` | Update only the named provider(s); repeat or pass comma-separated values. |
| `update` | `--force` | `false` | Overwrite Project Context edits and remove detected obsolete generated outputs without confirmation. |
| `install` | `--global` | `false` | Required by `install`; selects user-level installation. |
| `install` | `--ai <provider>` | interactive | Install for one or more globally supported providers. |
| `install` | `--exclude <names>` | none | Omit comma/space-separated sources from the global installation. |
| `install` | `--force` | `false` | Overwrite an existing global installation without confirmation. |
| `list` | none | — | No command-specific options. |
| `export` | `[names...]` | interactive picker | Source names to export; hyphen and underscore forms are accepted. |
| `export` | `--all` | `false` | Include all agents, skills, and references. |
| `export` | `-o, --output <file>` | `spec-lite-prompts.md` | Write to a file; use `-` for stdout. |
| `export` | `--no-references` | references included | Omit `help` and `orchestrator` when used with `--all`. |

### Initialize a project

```bash
spec-lite init
spec-lite init --ai codex,copilot --exclude yolo --force
```

`init` writes the current v2 configuration, provider-specific outputs, shared root-instruction blocks, selected stack baselines, and optional memory seed.

### Update a project

```bash
spec-lite update
spec-lite update --ai codex,claude-code
spec-lite update --force
```

Update performs the complete project migration:

- refreshes all configured agents, skills, prompts, native skill references/assets, and shared root-instruction blocks;
- preselects newly shipped sources so accepting the defaults installs them;
- updates `.spec-lite.json` to the current version and `format: "v2"`, adds `providers`, and collects the `documentation` section when it is missing;
- offers newly detected but unconfigured harnesses as opt-in providers;
- restores missing selected stack baselines without overwriting edited ones;
- detects obsolete v0.1.x outputs and asks before deleting them;
- preserves content inside Project Context markers unless `--force` is used.

### Install globally

```bash
spec-lite install --global
spec-lite install --global --ai codex,claude-code,copilot,pi
spec-lite install --global --ai codex --exclude yolo --force
```

### List the catalog

```bash
spec-lite list
```

### Export portable prompts

```bash
spec-lite export plan feature implement review
spec-lite export --all
spec-lite export --all --no-references -o prompts.md
spec-lite export review -o -
```

Without names or `--all`, Export opens the same grouped source picker used by Update. The output contains a grouped table of contents, initialized Project Context, inlined source-local references, rewritten cross-role links, and no YAML frontmatter.

## Configuration

`.spec-lite.json` records the format/version, selected providers, installed sources, timestamps, optional project profile, and documentation settings:

```json
{
  "version": "0.2.0",
  "format": "v2",
  "provider": "codex",
  "providers": ["codex", "claude-code"],
  "installedPrompts": ["brainstorm", "plan", "feature", "implement", "review"],
  "installedAt": "2026-08-15T12:00:00.000Z",
  "updatedAt": "2026-08-15T12:00:00.000Z",
  "documentation": {
    "directory": "docs",
    "level": "technical",
    "updateWithDevelopment": true
  }
}
```

Update owns generated provider outputs and only the spec-lite marker blocks inside shared instruction files. Unrelated user content is retained.

## Development

```bash
git clone https://github.com/abranjith/spec-lite.git
cd spec-lite
git switch development
npm install
npm run build
npm run typecheck
npm test
```

| Command | Purpose |
|---|---|
| `npm run dev` | Rebuild on source changes. |
| `npm run build` | Bundle the CLI and copy prompt/stack assets to `dist/`. |
| `npm run typecheck` | Run strict TypeScript checking. |
| `npm test` | Run the Vitest regression suite. |

Repository layout:

```text
agents/       Strategic autonomous roles
skills/       Reusable task workflows and local references/assets
references/   Shared help and orchestration contracts
src/          TypeScript CLI, providers, stack baselines, and utilities
test/         Catalog, handoff, link, detection, upgrade, export, and stack tests
```

## Contributing

Issues and pull requests are welcome. **Open pull requests against the `development` branch, not `main`.**

Before submitting a change:

1. Keep source catalog mappings, provider handoffs, relative Markdown links, canonical shared blocks, and Project Context markers synchronized.
2. Add or update regression tests for CLI and provider behavior.
3. Run `npm run build`, `npm run typecheck`, and `npm test`.
4. Set the pull request base branch to `development`.

## License

MIT — see [LICENSE](LICENSE).
