# spec-lite

> Lightweight, modular, LLM-agnostic prompt collection for structured software engineering — with a CLI installer.

## What Is This?

spec-lite is a set of **modular prompt files** — each defining a specialist AI agent for one phase of the software development lifecycle. Install once, and spec-lite configures your workspace for your AI coding assistant of choice.

**No frameworks. No lock-in. Just markdown prompts that work everywhere.**

### Design Principles

- **Lightweight** — Plain markdown files. Minimal CLI.
- **Modular** — Use one agent or all of them. Skip what you don't need.
- **Unopinionated** — Adapts to any project type (web, CLI, library, desktop, pipeline), any language, any stack.
- **Finite-scoped** — Each agent has one job, clear inputs, and a concrete output artifact.
- **Provider-agnostic** — Works with GitHub Copilot, Claude Code, or any LLM via generic mode.

---

## Installation

```bash
npm install -g spec-lite
```

Requires Node.js 18+.

## Quick Start

Navigate to your project workspace and run:

```bash
# For GitHub Copilot users
spec-lite init --ai copilot

# For Claude Code users
spec-lite init --ai claude-code

# For any other LLM (raw prompts you can copy-paste)
spec-lite init --ai generic
```

This will:
1. Write agent prompt files to the correct location for your AI tool
2. Create the `.spec/` directory structure for agent outputs
3. Save a `.spec-lite.json` config to track your setup

### Exclude specific agents

```bash
spec-lite init --ai copilot --exclude brainstorm,readme
```

### Update prompts to latest version

```bash
spec-lite update
```

This pulls the latest prompt versions while **preserving your Project Context edits**.

---

## Supported AI Providers

| Provider | Flag | Files Written To | Format |
|----------|------|-----------------|--------|
| GitHub Copilot | `--ai copilot` | `.github/copilot/*.md` | Markdown |
| Claude Code | `--ai claude-code` | `.claude/prompts/*.md` + `CLAUDE.md` | Markdown |
| Generic | `--ai generic` | `.spec-lite/prompts/*.md` | Raw markdown (copy-paste) |

More providers (Cursor, Windsurf, Cline, Zed) coming soon.

## The Agent Pipeline

```
Brainstorm ─→ Planner ─→ Feature (×N) ─→ Reviews ─→ Tests ─→ DevOps ─→ Docs
                                          ├─ Code Review
                                          ├─ Security Audit
                                          └─ Performance Review
```

Not every project needs every agent. Start with the Planner if you already have requirements. Skip Performance Review for simple CRUD apps. Use what fits.

## Prompt Files

| File | Agent | What It Does | Output |
|------|-------|-------------|--------|
| [brainstorm.md](prompts/brainstorm.md) | Brainstorm | Refines a vague idea into a clear vision | `.spec/brainstorm.md` |
| [planner.md](prompts/planner.md) | Planner | Creates a detailed technical blueprint | `.spec/plan.md` |
| [feature.md](prompts/feature.md) | Feature | Breaks one feature into granular, verifiable tasks | `.spec/features/feature_<name>.md` |
| [code_review.md](prompts/code_review.md) | Code Review | Reviews code for correctness, architecture, readability | `.spec/reviews/code_review_<name>.md` |
| [security_audit.md](prompts/security_audit.md) | Security Audit | Scans for vulnerabilities and security risks | `.spec/reviews/security_audit_<scope>.md` |
| [performance_review.md](prompts/performance_review.md) | Performance Review | Identifies bottlenecks and optimization opportunities | `.spec/reviews/performance_review_<scope>.md` |
| [integration_tests.md](prompts/integration_tests.md) | Integration Tests | Writes traceable test scenarios from feature specs | `tests/` |
| [devops.md](prompts/devops.md) | DevOps | Sets up Docker, CI/CD, environments, and deployment | Project infrastructure files |
| [fix.md](prompts/fix.md) | Fix & Refactor | Debugs issues or restructures code safely | Targeted fixes with verification |
| [technical_docs.md](prompts/technical_docs.md) | Technical Docs | Creates architecture documentation for developers | `docs/technical_architecture.md` |
| [readme.md](prompts/readme.md) | README | Writes the project README and optional user guide | `README.md` + `docs/user_guide.md` |
| [orchestrator.md](prompts/orchestrator.md) | — | Meta-document: pipeline, workflow, conflict resolution | Reference only |

## Quick Start (Manual)

### 1. Pick an agent

Choose the prompt file for your current task. Don't know where to start? Start with `planner.md`.

### 2. Copy the prompt into your LLM

Paste the full content of the prompt file into your LLM's system prompt (or at the start of a conversation).

### 3. Fill in the Project Context block

Every prompt has a `Project Context` section at the top. Fill it in with your project details:

```markdown
## Project Context (Customize per project)
- **Project Type**: CLI tool
- **Language(s)**: Python
- **Conventions**: PEP 8
- **Target Environment**: local-only
- **Team Size**: solo developer
```

### 4. Attach relevant context

If you're running the Feature Agent, attach `.spec/plan.md`. If you're running Code Review, attach the plan + feature spec + code. Each prompt lists its required inputs.

### 5. Interact

The agent follows its process and produces its defined output. Some agents (Brainstorm, Planner) are conversational — they'll ask questions. Others (Code Review, Security) analyze and produce a report.

## Output Directory Structure

spec-lite agents produce artifacts in two locations:

**Planning & review artifacts** → `.spec/` directory (version-controlled project metadata):

```
.spec/
├── brainstorm.md
├── plan.md
├── features/
│   ├── feature_user_management.md
│   └── feature_billing.md
└── reviews/
    ├── code_review_user_management.md
    ├── security_audit_auth.md
    └── performance_review_data_import.md
```

**Implementation artifacts** → project directories (actual project files):

```
tests/            ← Integration test scenarios
docs/             ← Technical docs + user guide
README.md         ← Project README
Dockerfile, CI configs, etc.  ← DevOps outputs
```

## Workflow & Conflict Resolution

See [orchestrator.md](prompts/orchestrator.md) for the complete workflow documentation, including:

- The full agent pipeline DAG
- When to skip agents
- Conflict resolution rules (user instruction > plan > agent expertise)
- Feedback loops between review agents and feature agents
- How to use spec-lite with different LLMs and coding agents

## CLI Commands

### `spec-lite init`

Initialize spec-lite prompts in your workspace.

```
Options:
  --ai <provider>      AI provider: copilot, claude-code, generic
  --exclude <prompts>  Comma-separated prompts to skip (e.g., brainstorm,readme)
  --force              Overwrite existing files without prompting
```

### `spec-lite update`

Update prompts to the latest version. Reads `.spec-lite.json` to know your provider and installed prompts. Preserves your Project Context edits.

```
Options:
  --force    Overwrite all files including user-modified ones
```

---

## Versioning

spec-lite relies on **git** for artifact versioning. When a plan or review is updated, commit with a meaningful message. Each prompt includes a version metadata comment (`<!-- spec-lite v1.0 | ... -->`) for traceability.

## Adapting & Contributing

spec-lite is designed to be forked and adapted:

- **Add project-specific conventions** to the Project Context blocks.
- **Remove agents** you don't need.
- **Add new agents** following the same pattern (Objective → Inputs → Process → Output → Constraints).
- **Modify output paths** to match your project's directory structure.

Contributions welcome — especially for new agent types, improvements to existing prompts, and real-world usage feedback.

## License

MIT. See [LICENSE](LICENSE) for details.
