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
- **Memory-aware** — Every sub-agent declares what artifacts it needs to read, ensuring continuity across the pipeline.
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
| GitHub Copilot | `--ai copilot` | `.github/copilot/*.prompt.md` | Slash-command prompts |
| Claude Code | `--ai claude-code` | `.claude/prompts/*.md` + `CLAUDE.md` | Markdown |
| Generic | `--ai generic` | `.spec-lite/prompts/*.md` | Raw markdown (copy-paste) |

More providers (Cursor, Windsurf, Cline, Zed) coming soon.

## The Sub-Agent Pipeline

```
spec_help (anytime)

Brainstorm ─→ Planner ─→ Feature (×N) ─→ Reviews ─→ Tests ─→ DevOps ─→ Docs
                │                          ├─ Code Review
                │                          ├─ Security Audit
                ▼                          └─ Performance Review
            TODO.md (living backlog)
```

Not every project needs every sub-agent. Start with the Planner if you already have requirements. Skip Performance Review for simple CRUD apps. Use `spec-lite list` or the spec_help sub-agent to understand the pipeline.

## Sub-Agent Prompt Files

| File | Sub-Agent | What It Does | Output |
|------|-----------|-------------|--------|
| [spec_help.md](prompts/spec_help.md) | Spec Help | Navigator — explains which sub-agent to use and when | Interactive guidance |
| [brainstorm.md](prompts/brainstorm.md) | Brainstorm | Back-and-forth ideation partner that refines vague ideas | `.spec/brainstorm.md` |
| [planner.md](prompts/planner.md) | Planner | Creates a detailed technical blueprint (living document) | `.spec/plan.md` |
| [feature.md](prompts/feature.md) | Feature | 3-phase lifecycle: explore → tasks → implement+test+docs | `.spec/features/feature_<name>.md` |
| [code_review.md](prompts/code_review.md) | Code Review | Reviews code for correctness, architecture, readability | `.spec/reviews/code_review_<name>.md` |
| [security_audit.md](prompts/security_audit.md) | Security Audit | Threat-models and scans for vulnerabilities | `.spec/reviews/security_audit.md` |
| [performance_review.md](prompts/performance_review.md) | Performance Review | Identifies bottlenecks and optimization opportunities | `.spec/reviews/performance_review.md` |
| [integration_tests.md](prompts/integration_tests.md) | Integration Tests | Writes traceable test scenarios from feature specs | `.spec/features/integration_tests_<name>.md` |
| [devops.md](prompts/devops.md) | DevOps | Sets up Docker, CI/CD, environments, and deployment | `.spec/devops/` + infra files |
| [fix.md](prompts/fix.md) | Fix | Debugs issues with root cause analysis + regression tests | `.spec/reviews/fix_<issue>.md` |
| [technical_docs.md](prompts/technical_docs.md) | Technical Docs | Creates architecture docs, API references, setup guides | Technical documentation |
| [readme.md](prompts/readme.md) | README | Writes the project README | `README.md` |
| [orchestrator.md](prompts/orchestrator.md) | — | Meta-document: pipeline, memory protocol, conflict resolution | Reference only |

## Output Directory Structure

spec-lite sub-agents produce artifacts in the `.spec/` directory (version-controlled project metadata):

```
.spec/
├── brainstorm.md
├── plan.md                    # Living document — user-modifiable
├── TODO.md                    # Enhancement backlog — maintained by planner + feature
├── features/
│   ├── feature_user_management.md
│   ├── feature_billing.md
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
- Enhancement tracking via `.spec/TODO.md`
- Invocation patterns for different scenarios (new project, feature addition, bug fix)

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

### `spec-lite list`

List all available sub-agents with their purpose and output artifacts.

```bash
spec-lite list
```

---

## Versioning

spec-lite relies on **git** for artifact versioning. When a plan or review is updated, commit with a meaningful message. Each prompt includes a version metadata comment (`<!-- spec-lite v1.1 | ... -->`) for traceability.

## Adapting & Contributing

spec-lite is designed to be forked and adapted:

- **Add project-specific conventions** to the Project Context blocks.
- **Remove sub-agents** you don't need.
- **Add new sub-agents** following the same pattern (Persona → Required Context → Process → Output Template → Constraints).
- **Modify output paths** to match your project's directory structure.
- **Edit the plan** — `.spec/plan.md` is a living document. Your edits take priority over sub-agent defaults.

Contributions welcome — especially for new sub-agent types, improvements to existing prompts, and real-world usage feedback.

## License

MIT. See [LICENSE](LICENSE) for details.
