# spec-lite

> Lightweight, modular, LLM-agnostic prompt collection for structured software engineering — with a CLI installer.

## What Is This?

spec-lite is a set of **modular prompt files** — each defining a specialist AI sub-agent for one phase of the software development lifecycle. Install once, and spec-lite configures your workspace for your AI coding assistant of choice.

**No frameworks. No lock-in. Just markdown prompts that work everywhere.**

### Design Principles

- **Lightweight** — Plain markdown files. Minimal CLI.
- **Modular** — Use one sub-agent or all of them. Skip what you don't need.
- **Unopinionated** — Adapts to any project type (web, CLI, library, desktop, pipeline), any language, any stack.
- **Finite-scoped** — Each sub-agent has one job, clear inputs, and a concrete output artifact.
- **Memory-first** — Cross-cutting standards (coding conventions, architecture, testing, security) live in `.spec-lite/memory.md` — the single source of truth read by every sub-agent.
- **Provider-agnostic** — Works with GitHub Copilot, Claude Code, or any LLM via generic mode.

---

## Installation

```bash
npm install -g @abranjith/spec-lite
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

The CLI will walk you through a short **project profile questionnaire** (language, frameworks, test framework, architecture style, and coding conventions). Your answers are used to:

1. Write agent prompt files to the correct location for your AI tool
2. Inject your tech-stack context into every prompt's `<!-- project-context -->` block
3. Copy a curated **best-practice snippet** for your stack into `.spec-lite/stacks/`
4. Create the `.spec-lite/` directory structure for agent outputs
5. Save a `.spec-lite.json` config (including your project profile) to track your setup

After init completes, run **`/memorize bootstrap`** (see below) to let the LLM auto-generate a comprehensive `memory.md` from your codebase.

### Exclude specific agents

```bash
spec-lite init --ai copilot --exclude brainstorm,readme
```

### Skip the profile questionnaire

```bash
spec-lite init --ai copilot --skip-profile
```

Use `--skip-profile` to skip the interactive questionnaire and install prompts without project-specific context.

### Update prompts to latest version

```bash
spec-lite update
```

This pulls the latest prompt versions while **preserving your Project Context edits**.

---

## Supported AI Providers

| Provider | Flag | Files Written To | Format |
|----------|------|-----------------|--------|
| GitHub Copilot | `--ai copilot` | `.github/prompts/spec.*.prompt.md` | Slash-command prompts |
| Claude Code | `--ai claude-code` | `.claude/prompts/spec.*.md` + `CLAUDE.md` | Markdown |
| Generic | `--ai generic` | `.spec-lite/prompts/spec.*.md` | Raw markdown (copy-paste) |

More providers (Cursor, Windsurf, Cline, Zed) coming soon.

## Memory-First Architecture

spec-lite uses a **memory-first** approach: cross-cutting concerns that every sub-agent needs — coding standards, architecture patterns, testing conventions, security guidelines, logging strategy — live in a single file: **`.spec-lite/memory.md`**.

| Source | Purpose | Authority |
|--------|---------|-----------|
| `.spec-lite/memory.md` | Cross-cutting standards & conventions | **Primary** — authoritative for all sub-agents |
| `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md` | Project-specific blueprint(s) & task breakdown | Overrides memory only with explicit justification |
| User instruction | Ad-hoc guidance in chat | Highest priority (trumps both) |

### Bootstrap Flow

After running `spec-lite init`, bootstrap your memory in one step:

```
/memorize bootstrap
```

The memorize sub-agent will:
1. Read your project profile from `.spec-lite.json`
2. Scan your repository structure, configs, and existing code
3. Load the curated best-practice snippet for your stack (from `.spec-lite/stacks/`)
4. Optionally look up community standards via web search
5. Synthesize everything into a comprehensive `memory.md`
6. Present the draft for your confirmation before saving

Once memory is bootstrapped, the **Planner** focuses on project-specific architecture and task breakdown — it no longer re-derives coding standards, testing conventions, or security guidelines.

## The Sub-Agent Pipeline

```
spec_help (anytime)

                  ┌─ /memorize bootstrap (one-time setup)
                  ▼
Brainstorm ─→ Planner ─→ Architect ─→ Feature (×N) ─→ Reviews ─→ Tests ─→ DevOps ─→ Docs
                │                          ├─ Code Review
                │                          ├─ Security Audit
                ▼                          └─ Performance Review
            TODO.md (living backlog)
```

All sub-agents read `.spec-lite/memory.md` first for standing instructions, then the relevant plan (`.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`) for project-specific context. Complex projects can have multiple named plans — one per domain (e.g., `plan_order_management.md`, `plan_catalog.md`). Not every project needs every sub-agent. Start with the Planner if you already have requirements. Use `spec-lite list` or the spec_help sub-agent to understand the pipeline.

## Sub-Agent Prompt Files

| File | Sub-Agent | What It Does | Output |
|------|-----------|-------------|--------|
| [spec_help.md](prompts/spec_help.md) | Spec Help | Navigator — explains which sub-agent to use and when | Interactive guidance |
| [brainstorm.md](prompts/brainstorm.md) | Brainstorm | Back-and-forth ideation partner that refines vague ideas | `.spec-lite/brainstorm.md` |
| [planner.md](prompts/planner.md) | Planner | Creates a detailed technical blueprint (living document) | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md` |
| [architect.md](prompts/architect.md) | Architect | Designs cloud infrastructure, database strategy, and scaling architecture | `.spec-lite/architect_<name>.md` |
| [feature.md](prompts/feature.md) | Feature | 3-phase lifecycle: explore → tasks → implement+test+docs | `.spec-lite/features/feature_<name>.md` |
| [code_review.md](prompts/code_review.md) | Code Review | Reviews code for correctness, architecture, readability | `.spec-lite/reviews/code_review_<name>.md` |
| [security_audit.md](prompts/security_audit.md) | Security Audit | Threat-models and scans for vulnerabilities | `.spec-lite/reviews/security_audit.md` |
| [performance_review.md](prompts/performance_review.md) | Performance Review | Identifies bottlenecks and optimization opportunities | `.spec-lite/reviews/performance_review.md` |
| [integration_tests.md](prompts/integration_tests.md) | Integration Tests | Writes traceable integration test scenarios from feature specs | `.spec-lite/features/integration_tests_<name>.md` |
| [unit_tests.md](prompts/unit_tests.md) | Unit Tests | Generates comprehensive unit tests with edge-case coverage and smart coverage exclusions | `.spec-lite/features/unit_tests_<name>.md` |
| [devops.md](prompts/devops.md) | DevOps | Sets up Docker, CI/CD, environments, and deployment | `.spec-lite/devops/` + infra files |
| [fix.md](prompts/fix.md) | Fix | Debugs issues with root cause analysis + regression tests | `.spec-lite/reviews/fix_<issue>.md` |
| [technical_docs.md](prompts/technical_docs.md) | Technical Docs | Creates architecture docs, API references, setup guides | Technical documentation |
| [readme.md](prompts/readme.md) | README | Writes the project README | `README.md` |
| [memorize.md](prompts/memorize.md) | Memorize | Manages `.spec-lite/memory.md` — standing instructions for all agents. Use `/memorize bootstrap` to auto-generate. | `.spec-lite/memory.md` |
| [explore.md](prompts/explore.md) | Explore | Explores an unfamiliar codebase and documents architecture, patterns, and improvement areas. ⚠️ May consume many requests. | `README.md` + `TECH_SPECS.md` + `.spec-lite/memory.md` |
| [orchestrator.md](prompts/orchestrator.md) | — | Meta-document: pipeline, memory protocol, conflict resolution | Reference only |

## Output Directory Structure

spec-lite sub-agents produce artifacts in the `.spec-lite/` directory (version-controlled project metadata):

```
.spec-lite/
├── memory.md                  # Cross-cutting standards — authoritative source
├── brainstorm.md
├── plan.md                    # Default plan (simple projects) — user-modifiable
├── plan_<name>.md             # Named plans (complex projects, e.g., plan_order_management.md)
├── architect_<name>.md        # Cloud & infrastructure architecture (e.g., architect_fintech_platform.md)
├── TODO.md                    # Enhancement backlog — maintained by planner + feature
├── features/
│   ├── feature_user_management.md
│   ├── feature_billing.md
│   ├── unit_tests_user_management.md
│   └── integration_tests_user_management.md
├── reviews/
│   ├── code_review_user_management.md
│   ├── security_audit.md
│   ├── performance_review.md
│   └── fix_create_order_null.md
└── devops/
    └── ...                    # Infrastructure artifacts
```

Implementation artifacts (tests, docs, infra configs) are written to standard project directories.

## Workflow & Conflict Resolution

See [orchestrator.md](prompts/orchestrator.md) for the complete workflow documentation, including:

- The full sub-agent pipeline DAG
- Memory protocol — which artifacts each sub-agent reads
- Conflict resolution rules (user instruction > plan > sub-agent expertise)
- Enhancement tracking via `.spec-lite/TODO.md`
- Invocation patterns for different scenarios (new project, feature addition, bug fix)

## CLI Commands

### `spec-lite init`

Initialize spec-lite prompts in your workspace.

```
Options:
  --ai <provider>      AI provider: copilot, claude-code, generic
  --exclude <prompts>  Comma-separated prompts to skip (e.g., brainstorm,readme)
  --skip-profile       Skip the interactive project profile questionnaire
  --force              Overwrite existing files without prompting
```

### `spec-lite update`

Update prompts to the latest version. Reads `.spec-lite.json` to know your provider and installed prompts. Preserves your Project Context edits.

```
Options:
  --force    Overwrite all files including user-modified ones
```

### `spec-lite list`

List all available sub-agents with their purpose and output artifacts.

```bash
spec-lite list
```

---

## Versioning

spec-lite relies on **git** for artifact versioning. When a plan or review is updated, commit with a meaningful message. Each prompt includes a version metadata comment (`<!-- spec-lite v0.0.1 | ... -->`) for traceability.

## Adapting & Contributing

spec-lite is designed to be forked and adapted:

- **Bootstrap memory first** — run `/memorize bootstrap` after init to populate `.spec-lite/memory.md` with your project's standards.
- **Edit memory directly** — `.spec-lite/memory.md` is the standing-instruction file. Your edits persist across all sub-agent invocations.
- **Add project-specific conventions** to the Project Context blocks or directly to memory.
- **Remove sub-agents** you don't need.
- **Add new sub-agents** following the same pattern (Persona → Required Context → Process → Output Template → Constraints).
- **Modify output paths** to match your project's directory structure.
- **Edit the plan** — `.spec-lite/plan.md` (or `.spec-lite/plan_<name>.md` for named plans) is a living document. Your edits take priority over sub-agent defaults.
- **Add stack snippets** — drop a `<language>.md` file into `src/stacks/` to add best-practice snippets for additional languages.

Contributions welcome — especially for new sub-agent types, improvements to existing prompts, and real-world usage feedback.

## License

MIT. See [LICENSE](LICENSE) for details.
