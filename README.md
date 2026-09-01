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
- **Extensible lifecycle hooks** — subscribe your own commands, webhooks, or skill hand-offs to versioned events; changeset capture is just the pair that ships enabled.
- **First-class documentation** — choose the documentation directory and depth, with optional updates during implementation and fixes.
- **Shared memory** — durable project conventions live in `.spec-lite/memory.md` and can be captured as the work evolves.
- **Stable feature IDs** — `FEAT-###` identifiers remain consistent across plans, feature specs, implementation, tests, and review.
- **14 stack baselines** — TypeScript, Python, Java, .NET, Go, Rust, Kotlin, Swift, C/C++, PHP, Ruby, React, Vue, and Angular.
- **Safe upgrades** — update every configured provider, preselect newly shipped roles, migrate config and legacy flat feature specs (including `FEAT-FP-###` IDs), preserve Project Context edits, and clean obsolete generated outputs with confirmation.
- **Portable export** — combine selected roles and references into one self-contained Markdown prompt for chat tools, teammates, or unsupported harnesses.

## Install

Requires Node.js 22 or newer (current LTS).

```bash
npm install -g @abranjith/spec-lite
spec-lite install --global --ai codex,claude-code,copilot,pi

cd your-project
spec-lite init
```

The first command installs the reusable roles for the harnesses you use; the second records this project's providers, profile, and documentation preferences in `.spec-lite.json`. Full walkthrough: [Quickstart](docs/quickstart.md).

## Use it

Run the full flow for a new application, or just the part a task needs:

```text
Brainstorm → Plan → Feature × N → Implement → Review → Integration Tests → Document
```

| Situation | Suggested workflow |
|---|---|
| Clear idea for a new project | Plan → Feature → Implement → Review |
| One focused enhancement | Feature Planner → Implement → Review → Document Update |
| Existing defect or refactor | Fix → Review |
| Architecture decision | Architect, then Plan or DevOps |
| Existing plan needs a challenge | Plan Critic → revise or continue |
| Well-scoped autonomous build | YOLO |

**5 agents** — Brainstormer, Planner, Feature Planner, Architect, YOLO.

**17 skills** — Feature, Implement, Review, Fix, Unit Tests, Integration Tests, Document (+ Design, Feature, Usage, README writers), Memorize, Plan Critic, Data Model, DevOps, Todo, Tool Helper.

Personas, harness-by-harness selection, and example prompts for every role: [Agents and skills](docs/features/agents-and-skills.md).

## Documentation

| Document | What it covers |
|---|---|
| [Quickstart](docs/quickstart.md) | Install, initialize, run a first workflow, hand off between harnesses |
| [Architecture](docs/architecture.md) | Global roles vs. local state, provider adapters, project layout, configuration |
| [CLI reference](docs/usage.md) | Every command and option, including the hooks API |
| [Agents and skills](docs/features/agents-and-skills.md) | The full catalog, selection per harness, example prompts |
| [Hooks](docs/features/hooks.md) | Subscribe automation to lifecycle events; built-in changeset capture |
| [Review](docs/features/review.md) | Deterministic scopes, findings, verdicts |
| [Documentation](docs/features/documentation.md) | Documentation settings, document set, and modes |
| [Memory and project state](docs/features/memory.md) | Standing conventions and what to commit |

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
| `npm run generate:hooks-schema` | Regenerate `schema/hooks.schema.json` from the source of truth. |
| `npm run generate:hook-docs` | Regenerate the hook variable and event tables in the docs. |

Repository layout is described in [Architecture](docs/architecture.md#repository-layout-of-spec-lite-itself).

## Contributing

Issues and pull requests are welcome. **Open pull requests against the `development` branch, not `main`.**

Before submitting a change:

1. Keep source catalog mappings, provider handoffs, relative Markdown links, canonical shared blocks, and Project Context markers synchronized.
2. Add or update regression tests for CLI and provider behavior.
3. Run `npm run build`, `npm run typecheck`, and `npm test`.
4. Set the pull request base branch to `development`.

## License

MIT — see [LICENSE](LICENSE).
