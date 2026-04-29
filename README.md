# spec-lite

> Surgical, spec-driven prompts for professional software development — no tools, no framework, no lock-in.

## What Is This?

spec-lite is a curated collection of **precise, modular agents and skills** — each targeting one phase of the software development lifecycle. Every definition is self-contained markdown with YAML frontmatter. There is no runtime, no SDK, no agent harness. Install once, and spec-lite places the right files in the right locations for your AI coding assistant.

**Just markdown prompts that work everywhere.**

## What It Is

- **Surgical prompts for spec-driven development.** Each agent or skill targets a specific SDLC activity — planning, feature design, implementation, code review, testing, security audit, DevOps, and more. They are precise, finite-scoped, and produce concrete output artifacts.
- **No tools attached.** spec-lite ships zero tools on purpose. Modern AI agents are excellent at creating tools themselves, and every project's tooling needs are different. Instead, spec-lite includes a **Tool Helper** skill (`/spec.tool_help`) that helps you create project-specific bash tools in `.spec-lite/tools/` — which other agents and skills can then discover and use to inject project context.
- **Provider-native installation.** Built-in support for **GitHub Copilot**, **Claude Code**, and **Pi** — agents and skills are written using each provider's native primitives (e.g., Copilot gets `.agent.md` files with handoff support in `.github/agents/` plus native skill directories in `.github/skills/`; Claude Code gets agent files in `.claude/agents/` with both source agents and skills mapped onto its agent surface; Pi gets native skill directories in `.pi/skills/`). For any other LLM, use `--ai generic` or just copy the raw markdown files.
- **Global installation support.** Install agents and skills once at the user level (`spec-lite install --global`) so they're available across all your workspaces — supported for Copilot, Claude Code, and Pi.
- **Slash-command invocation.** Once installed, agents and skills are invoked with `/` commands (e.g., `/spec.plan`, `/spec.feature`) or via your provider's agent selection UI.
- **YOLO mode.** For when you want to go fully autonomous — the YOLO agent drives the entire spec-lite pipeline end to end, from planning through implementation, reviews, and documentation. Pausable, resumable, with checkpoints at every phase.
- **Memory support.** `.spec-lite/memory.md` is a user-controlled file of standing instructions (coding standards, architecture decisions, testing conventions) read by every agent and skill. Bootstrap it automatically with `/spec.memorize bootstrap`, or edit it directly. Some skills also auto-update memory when they discover new conventions.
- **TODO helper.** `.spec-lite/TODO.md` is a living backlog. The `/spec.todo` skill adds items under the right category, and other agents (planner, plan_critic, feature) auto-append enhancements they discover during their work.
- **Large project exploration.** The `/spec.explore` agent systematically maps unfamiliar or large codebases — including monorepos — producing structured documentation of architecture, patterns, and data models. It works top-down through the dependency graph and handles multi-project repositories by exploring one project at a time.

## What It Is Not

- **Not an agent harness or framework.** There is no runtime, no orchestration engine, no message bus. spec-lite is just prompt files — your AI coding assistant does all the work.
- **Not a code library.** spec-lite doesn't ship application code. It ships instructions that tell your AI assistant *how* to write code following professional engineering practices.

---

## Installation

```bash
npm install -g @abranjith/spec-lite
```

Requires Node.js 20+.

## Quick Start

Navigate to your project workspace and run:

```bash
# For GitHub Copilot users
spec-lite init --ai copilot

# For Claude Code users
spec-lite init --ai claude-code

# For Pi users
spec-lite init --ai pi

# For any other LLM (raw prompts you can copy-paste)
spec-lite init --ai generic
```

The CLI will walk you through a short **project profile questionnaire** (languages, frameworks, test frameworks, architecture patterns, and coding conventions). Language(s) and architecture pattern(s) are selected interactively, while frameworks and test frameworks are entered as comma-separated lists. Your answers are used to:

1. Write agent and skill files to the correct location for your AI tool
2. Inject your tech-stack context into each file's `<!-- project-context -->` block
3. Copy one or more curated **best-practice snippets** for your stack into `.spec-lite/stacks/`
4. Create the `.spec-lite/` directory structure for agent outputs
5. Save a `.spec-lite.json` config (including your project profile as arrays for mixed-stack repositories) to track your setup

This works for monorepos and polyglot repositories as well as single-stack apps. For example, you can initialize a repo that uses TypeScript + Python, or a frontend/backend mix like React + FastAPI, without having to collapse everything into a single “primary” stack.

After init completes, run **`/spec.memorize bootstrap`** (see below) to let the LLM auto-generate a comprehensive `memory.md` from your codebase.

### Exclude specific agents

```bash
spec-lite init --ai copilot --exclude brainstorm,write_readme
```

### Skip the profile questionnaire

```bash
spec-lite init --ai copilot --skip-profile
```

### Install globally (user-level)

```bash
spec-lite install --global --ai copilot
```

Global prompts are available across all your workspaces without running `init` in each one.

### Update prompts to latest version

```bash
spec-lite update
```

This pulls the latest prompt versions while **preserving your Project Context edits**.

---

## Supported AI Providers

| Provider | Flag | Agent Files | Skill Directories | Global Support |
|----------|------|-------------|-------------------|----------------|
| GitHub Copilot | `--ai copilot` | `.github/agents/spec.*.agent.md` | `.github/skills/spec-*/SKILL.md` | ✅ |
| Claude Code | `--ai claude-code` | `.claude/agents/spec.*.md` + `CLAUDE.md` | — (skills delivered as agents) | ✅ |
| Pi | `--ai pi` | — (agents delivered as skills) | `.pi/skills/spec-*/SKILL.md` | ✅ |
| Generic | `--ai generic` | — | — | — |

Providers use whichever native primitives they support: Copilot writes both agents and skills, Claude Code maps both source agents and source skills to its agent surface, and Pi expresses agents as native skills. The Generic provider emits raw markdown for copy-paste into any LLM. For providers not listed above (Cursor, Windsurf, Cline, Zed, etc.), use `--ai generic` and copy the markdown files into your tool's expected location.

## Memory-First Architecture

spec-lite uses a **memory-first** approach: cross-cutting concerns that every agent and skill needs — coding standards, architecture patterns, testing conventions, security guidelines, logging strategy — live in a single file: **`.spec-lite/memory.md`**.

| Source | Purpose | Authority |
|--------|---------|----------|
| `.spec-lite/memory.md` | Cross-cutting standards & conventions | **Primary** — authoritative for all agents and skills |
| `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md` | Project-specific blueprint(s) & task breakdown | Overrides memory only with explicit justification |
| User instruction | Ad-hoc guidance in chat | Highest priority (trumps both) |

### Bootstrap Flow

After running `spec-lite init`, bootstrap your memory in one step:

```
/spec.memorize bootstrap
```

The memorize skill will:
1. Read your project profile from `.spec-lite.json`
2. Scan your repository structure, configs, and existing code
3. Load one or more curated best-practice snippets for your stack(s) from `.spec-lite/stacks/`
4. Optionally look up community standards via web search
5. Synthesize everything into a comprehensive `memory.md`
6. Present the draft for your confirmation before saving

Once memory is bootstrapped, the **Planner** focuses on project-specific architecture and task breakdown — it no longer re-derives coding standards, testing conventions, or security guidelines.

When you want a second pass before coding, run **`/spec.plan_critic`** against a generated plan to pressure-test feasibility, technical risk, product quality, and future adaptability. You can also include supporting context such as `.spec-lite/brainstorm.md` or one or more `.spec-lite/features/feature_<name>.md` files.

## The Pipeline

```
help (anytime)

                  ┌─ /spec.memorize bootstrap (one-time setup)
                  ▼
Brainstorm ─→ Planner ─→ Architect ─→ Feature (×N) ─→ Reviews ─→ Tests ─→ DevOps ─→ Docs
                │              │           ├─ Code Review
                │              │           ├─ Security Audit
                ▼              ▼           └─ Performance Review
            TODO.md     Data Modeller

Optional manual checkpoint after planning: `/spec.plan_critic .spec-lite/plan.md`
```

All agents and skills read `.spec-lite/memory.md` first for standing instructions, then the relevant plan for project-specific context. Complex projects can have multiple named plans — one per domain (e.g., `plan_order_management.md`, `plan_catalog.md`). Not every project needs every agent. Start with the Planner if you already have requirements. Use `spec-lite list` or the spec_help reference to understand the pipeline.

## Real-World Workflows

Not every project follows the full pipeline. Here are the most common workflows, with the exact invocations for each.

### Large Feature Development

For substantial work that spans multiple features — a new module, a major refactor, or an epic with several user stories.

```
/spec.memorize bootstrap     ← one-time (if not already done)
/spec.plan                   ← produces .spec-lite/plan.md with task breakdown
/spec.plan_critic .spec-lite/plan.md  ← optional manual critique before feature work
  ↓
  ┌── for each feature in the plan ──┐
  │  /spec.feature                    │  ← creates .spec-lite/features/feature_<name>.md
  │  /spec.implement                  │  ← writes code, tests, and docs from the feature spec
  │  /spec.review_code                │  ← review the implementation
  │  (iterate if review has findings) │
  └───────────────────────────────────┘
/spec.review_security        ← once all features are in place
/spec.write_readme           ← update project README
```

**Example:** You're building an e-commerce checkout system. Run `/spec.plan` with your requirements — it produces a plan breaking the work into features like *cart management*, *payment processing*, *order confirmation*, and *email notifications*. Before feature work starts, optionally run `/spec.plan_critic .spec-lite/plan.md` to pressure-test feasibility, sequencing, and product gaps. Then for each feature: `/spec.feature` to spec it out, `/spec.implement` to build it, and `/spec.review_code` to catch issues before moving on. After all features land, run `/spec.review_security` to threat-model the entire checkout flow.

### Small / Single Feature

For a contained piece of work — an API endpoint, a UI component, a new utility. No full plan needed.

```
/spec.plan_feature           ← produces .spec-lite/features/feature_<name>.md directly
/spec.implement              ← writes code, tests, and docs
/spec.review_code            ← review the implementation
```

**Example:** You need to add a "forgot password" flow. Run `/spec.plan_feature` describing the feature — it creates a single actionable feature spec in one shot, skipping the overhead of a full project plan. Then `/spec.implement` builds it and `/spec.review_code` validates the result.

### Bug Fix

For diagnosing and fixing a reported issue — includes root cause analysis and regression tests.

```
/spec.fix                    ← diagnoses root cause, applies fix, adds regression tests
/spec.review_code            ← review the fix
```

**Example:** Users report that search results are duplicated when filters are applied. Run `/spec.fix` with the bug description — it traces the issue to a missing deduplication step in the query pipeline, applies the fix, and writes a regression test. Then `/spec.review_code` confirms the fix is correct and doesn't introduce side effects.

### Greenfield Project

Starting from scratch — from idea to deployed code.

```
/spec.brainstorm             ← refine the idea interactively
/spec.memorize bootstrap     ← set up coding standards and conventions
/spec.plan                   ← full technical blueprint
/spec.plan_critic .spec-lite/plan.md  ← optional manual critique before implementation
/spec.architect              ← infrastructure and database design
/spec.build_data_model       ← data model from domain description
  ↓
  (feature loop — same as Large Feature Development above)
  ↓
/spec.devops                 ← Docker, CI/CD, deployment
/spec.write_readme           ← project documentation
```

**Example:** You have a rough idea for a task management API. Start with `/spec.brainstorm` to clarify scope and requirements. Then `/spec.memorize bootstrap` to establish conventions, `/spec.plan` for the full blueprint, and optionally `/spec.plan_critic .spec-lite/plan.md` to catch feasibility or product issues early. Continue with `/spec.architect` for infrastructure decisions and `/spec.build_data_model` for the schema. Work through features one by one, then finish with `/spec.devops` for deployment and `/spec.write_readme` for documentation. You can write all ideas (even if it is incomplete) in a .idea file in the main directory and the brainstorm agent will read from it.

### Exploring an Existing Codebase

When you inherit or join a project and need to understand what's there.

```
/spec.explore                ← maps the codebase structure, patterns, and architecture
/spec.memorize bootstrap     ← captures discovered conventions into memory
```

**Example:** You're onboarded to a large monorepo with multiple services. Run `/spec.explore` — it systematically walks the dependency graph, documents architecture patterns, data models, and inter-service communication, and produces structured exploration docs. Then `/spec.memorize bootstrap` distills those findings into standing instructions for all future agent and skill work.

### Autonomous Mode (YOLO)

For when you trust the pipeline and want it to run end-to-end with minimal intervention. Best for greenfield projects or well-scoped feature sets.

```
/spec.yolo                   ← runs the entire pipeline autonomously with checkpoints
```

The YOLO agent drives planning through implementation, reviews, and documentation — pausing at checkpoints for your approval before proceeding to the next phase.

> [!TIP]
> Once a plan is created, run `/spec.plan_critic .spec-lite/plan.md` or `/spec.plan_critic .spec-lite/plan_<name>.md` before implementation to pressure-test feasibility, technical risks, product improvements, and future enhancements.

## Agents, Skills & References

| Source | Name | Type | What It Does | Output |
|--------|------|------|-------------|--------|
| [references/help.md](references/help.md) | Spec Help | Reference | Navigator — explains which agent or skill to use and when | Interactive guidance |
| [agents/brainstorm/](agents/brainstorm/AGENT.md) | Brainstorm | Agent | Back-and-forth ideation partner that refines vague ideas | `.spec-lite/brainstorm.md` |
| [agents/plan/](agents/plan/AGENT.md) | Planner | Agent | Creates a detailed technical blueprint (living document) | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md` |
| [skills/plan-critic/](skills/plan-critic/SKILL.md) | Plan Critic | Skill | Reviews plans for feasibility, technical risks, product improvements, and adaptability | `.spec-lite/reviews/plan_critique_<scope>.md` |
| [skills/todo/](skills/todo/SKILL.md) | TODO | Skill | Adds backlog items to TODO.md under the right category | `.spec-lite/TODO.md` |
| [agents/architect/](agents/architect/AGENT.md) | Architect | Agent | Designs cloud infrastructure, database strategy, and scaling architecture | `.spec-lite/architect_<name>.md` |
| [skills/build-data-model/](skills/build-data-model/SKILL.md) | Data Modeller | Skill | Transforms domain descriptions into optimized relational data models | `.spec-lite/data_model.md` |
| [skills/feature/](skills/feature/SKILL.md) | Feature | Skill | 3-phase lifecycle: explore → tasks → implement+test+docs | `.spec-lite/features/feature_<name>.md` |
| [agents/plan-feature/](agents/plan-feature/AGENT.md) | Feature Planner | Agent | From idea to actionable feature spec in one shot — skips the full plan | `.spec-lite/features/feature_<name>.md` |
| [skills/implement/](skills/implement/SKILL.md) | Implement | Skill | Takes a completed feature spec and writes production code, tests, and docs | Code + tests + docs |
| [skills/review-code/](skills/review-code/SKILL.md) | Code Review | Skill | Reviews code for correctness, architecture, readability | `.spec-lite/reviews/code_review_<name>.md` |
| [skills/review-security/](skills/review-security/SKILL.md) | Security Audit | Skill | Threat-models and scans for vulnerabilities | `.spec-lite/reviews/security_audit.md` |
| [skills/review-performance/](skills/review-performance/SKILL.md) | Performance Review | Skill | Identifies bottlenecks and optimization opportunities | `.spec-lite/reviews/performance_review.md` |
| [skills/write-integration-tests/](skills/write-integration-tests/SKILL.md) | Integration Tests | Skill | Writes traceable integration test scenarios from feature specs | `.spec-lite/features/integration_tests_<name>.md` |
| [skills/write-unit-tests/](skills/write-unit-tests/SKILL.md) | Unit Tests | Skill | Generates comprehensive unit tests with edge-case coverage | `.spec-lite/features/unit_tests_<name>.md` |
| [skills/devops/](skills/devops/SKILL.md) | DevOps | Skill | Sets up Docker, CI/CD, environments, and deployment | `.spec-lite/devops/` + infra files |
| [skills/fix/](skills/fix/SKILL.md) | Fix | Skill | Debugs issues with root cause analysis + regression tests | `.spec-lite/reviews/fix_<issue>.md` |
| [skills/write-readme/](skills/write-readme/SKILL.md) | README | Skill | Writes the project README | `README.md` |
| [skills/memorize/](skills/memorize/SKILL.md) | Memorize | Skill | Manages `.spec-lite/memory.md` — standing instructions for all agents | `.spec-lite/memory.md` |
| [agents/explore/](agents/explore/AGENT.md) | Explore | Agent | Systematically maps unfamiliar codebases (including monorepos) | `docs/explore/<project>.md` + `.spec-lite/memory.md` |
| [skills/tool-help/](skills/tool-help/SKILL.md) | Tool Helper | Skill | Creates and edits project-specific bash tools in `.spec-lite/tools/` | `.spec-lite/tools/*.sh` |
| [agents/yolo/](agents/yolo/AGENT.md) | YOLO | Agent | Autonomous end-to-end pipeline — runs all phases from plan to docs | All of the above |
| [references/orchestrator.md](references/orchestrator.md) | — | Reference | Meta-document: pipeline, memory protocol, conflict resolution | Reference only |

## Output Directory Structure

spec-lite agents and skills produce artifacts in the `.spec-lite/` directory (version-controlled project metadata):

```
.spec-lite/
├── memory.md                  # Cross-cutting standards — authoritative source
├── brainstorm.md
├── plan.md                    # Default plan (simple projects) — user-modifiable
├── plan_<name>.md             # Named plans (complex projects, e.g., plan_order_management.md)
├── reviews/
│   ├── plan_critique_<scope>.md # Optional manual plan critiques
│   ├── code_review_<name>.md
│   ├── security_audit.md
│   ├── performance_review.md
│   └── fix_<issue>.md
├── architect_<name>.md        # Cloud & infrastructure architecture
├── data_model.md              # Relational data model
├── TODO.md                    # Enhancement backlog — maintained by planner + feature + todo
├── features/
│   ├── feature_<name>.md
│   ├── unit_tests_<name>.md
│   └── integration_tests_<name>.md
├── devops/
│   └── ...                    # Infrastructure artifacts
└── tools/
    └── ...                    # Project-specific bash tools (created via /spec.tool_help)
```

Implementation artifacts (tests, docs, infra configs) are written to standard project directories.

## Workflow & Conflict Resolution

See [orchestrator.md](references/orchestrator.md) for the complete workflow documentation, including:

- The full pipeline DAG
- Memory protocol — which artifacts each agent and skill reads
- Conflict resolution rules (user instruction > plan > agent/skill expertise)
- Enhancement tracking via `.spec-lite/TODO.md`
- Invocation patterns for different scenarios (new project, feature addition, bug fix)

## CLI Commands

### `spec-lite init`

Initialize spec-lite prompts in your workspace.

```
Options:
  --ai <provider>      AI provider: copilot, claude-code, pi, generic
  --exclude <prompts>  Comma-separated prompts to skip (e.g., brainstorm,write_readme)
  --skip-profile       Skip the interactive multi-stack project profile questionnaire
  --force              Overwrite existing files without prompting
```

### `spec-lite install --global`

Install prompts globally (user-level) for use across all workspaces.

```
Options:
  --ai <provider>      AI provider: copilot, claude-code, pi
  --exclude <prompts>  Comma-separated prompts to skip
  --force              Overwrite existing global files without prompting
```

### `spec-lite update`

Update prompts to the latest version. Reads `.spec-lite.json` to know your provider and installed prompts. Preserves your Project Context edits.

```
Options:
  --force    Overwrite all files including user-modified ones
```

### `spec-lite list`

List all available agents and skills with their type, purpose, and output artifacts.

```bash
spec-lite list
```

---

## Best Practices

1. **Bootstrap memory first.** After `spec-lite init`, run `/spec.memorize bootstrap` before doing anything else. This gives every agent and skill your project's coding standards, architecture conventions, and testing preferences from the start.

2. **Start with the Planner (or Feature Planner).** If you have clear requirements, go straight to `/spec.plan`. For a single contained feature, use `/spec.plan_feature` to skip the full plan and get an actionable spec in one shot.

3. **Use memory as your single source of truth.** Don't repeat conventions in every prompt invocation. Put them in `.spec-lite/memory.md` once and every agent and skill will pick them up.

4. **Create project-specific tools.** Use `/spec.tool_help` to create bash scripts in `.spec-lite/tools/` that gather project context (build output, test results, lint status). Other agents and skills automatically discover and use these tools.

5. **Commit `.spec-lite/` to version control.** Plans, feature specs, reviews, and memory are living documents. Treat them like code — commit with meaningful messages, review changes, and track evolution.

6. **Use YOLO mode sparingly.** YOLO is powerful but can consume a large number of AI requests. Best used for greenfield projects or well-scoped feature sets where you're comfortable with autonomous execution.

7. **Edit freely.** Plans, memory, and feature specs are your documents. Agents and skills respect your edits. The hierarchy is always: your direct instruction > plan > agent/skill defaults.

## Demos

See [spec-lite-demo](https://github.com/abranjith/spec-lite-demo) for walkthroughs and example projects built with spec-lite.

---

## Adapting & Contributing

spec-lite is designed to be forked and adapted:

- **Bootstrap memory first** — run `/spec.memorize bootstrap` after init to populate `.spec-lite/memory.md` with your project's standards.
- **Edit memory directly** — `.spec-lite/memory.md` is the standing-instruction file. Your edits persist across all agent and skill invocations.
- **Add project-specific conventions** to the Project Context blocks or directly to memory.
- **Remove agents or skills** you don't need.
- **Add new agents or skills** following the same pattern — agents use `AGENT.md` with YAML frontmatter in `agents/<name>/`, skills use `SKILL.md` with YAML frontmatter in `skills/<name>/`. Both support `references/` and `assets/` subdirectories.
- **Modify output paths** to match your project's directory structure.
- **Edit the plan** — `.spec-lite/plan.md` (or `.spec-lite/plan_<name>.md` for named plans) is a living document. Your edits take priority over agent/skill defaults.
- **Add stack snippets** — drop a `<language>.md` file into `src/stacks/` to add best-practice snippets for additional languages. If you add new language aliases, update `src/utils/stacks.ts` so init can map questionnaire answers to the canonical snippet filename.

Contributions welcome — especially for new agent and skill types, improvements to existing definitions, and real-world usage feedback.

## License

MIT. See [LICENSE](LICENSE) for details.
