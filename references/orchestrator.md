---
name: orchestrator
description: >
  Meta-reference that defines how all spec-lite agents and skills work together.
  Single source of truth for the pipeline, conventions, and conflict resolution rules.
metadata:
  author: spec-lite
---

# Orchestrator — Agent & Skill Pipeline Reference

You are the **Orchestrator**, not an agent or skill itself, but the meta-document that defines how all spec-lite agents and skills work together. This document is the single source of truth for the pipeline, conventions, and conflict resolution rules.

---

## Agent & Skill Pipeline

Agents and skills form a directed pipeline. Each one reads artifacts produced by earlier stages and produces artifacts consumed by later stages.

```
                    ┌──────────────┐
                    │     help     │  (navigator — can be invoked anytime)
                    └──────────────┘
                    ┌──────────────┐
                    │   memorize   │  (memory — can be invoked anytime)
                    └──────────────┘
                    ┌──────────────┐
                    │     todo     │  (backlog curation — can be invoked anytime)
                    └──────────────┘
                    ┌──────────────┐
                    │   explore    │  (codebase discovery — can be invoked anytime)
                    └──────────────┘
                    ┌──────────────┐
                    │     yolo     │  (autonomous orchestration — can be invoked anytime)
                    └──────────────┘

                    ┌──────────────┐
                    │  brainstorm  │  Phase 0: Ideation (optional, user-directed)
                    └──────┬───────┘
                           │ .spec-lite/brainstorm.md (only if user says "use brainstorm")
                           ▼
                    ┌──────────────┐
                    │     plan     │  Phase 1: Architecture & Planning
                    └──────┬───────┘
                           │ .spec-lite/plan.md or .spec-lite/plan_<name>.md
                           │ .spec-lite/TODO.md (updated)
                           │
                           ├──── Optional manual checkpoint ────► .spec-lite/reviews/plan_critique_<scope>.md
                           ▼
              ┌────────────────────────────────┐
              │        Phase 1.5: Design       │
              │  ┌────────────┐ ┌────────────┐ │
              │  │  architect │ │ build-data │ │
              │  │            │ │   -model   │ │
              │  └────────────┘ └────────────┘ │
              └──────────────┬─────────────────┘
                             │ .spec-lite/architect_<name>.md
                             │ .spec-lite/data_model.md
                             ▼
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌──────────────┐ ┌────────┐ ┌──────────┐
     │   feature    │ │  fix   │ │  devops  │  Phase 2: Specification
     └──────┬───────┘ └────┬───┘ └─────┬────┘
            │              │           │
            │ .spec-lite/features/feature_*.md
            │ .spec-lite/TODO.md (updated)
            ▼
     ┌──────────────┐     ┌──────────────┐
     │  implement   │     │ plan-feature │  Shortcut: idea → feature spec → implement
     └──────┬───────┘     └──────┬───────┘
            │                    │ .spec-lite/features/feature_*.md
            │◄───────────────────┘
            │  Phase 2.5: Implementation
            ▼
     ┌──────────────────────────────────────┐
     │          Review & Test               │  Phase 3: Validation
     │  ┌─────────────┐ ┌───────────────┐  │
     │  │ review-code │ │review-security│  │
     │  └─────────────┘ └───────────────┘  │
     │  ┌──────────────────┐ ┌─────────────────────┐ │
     │  │review-performance│ │write-integration-tests│ │
     │  └──────────────────┘ └─────────────────────┘ │
     │  ┌──────────────────┐                          │
     │  │write-unit-tests  │                          │
     │  └──────────────────┘                          │
     └──────────────────┬─────────────────────────────┘
                        │ .spec-lite/reviews/*.md
                        │ .spec-lite/features/{unit_tests_,integration_tests_}*.md
                        ▼
              ┌──────────────────┐
              │   write-readme   │  Phase 4: Polish
              └──────────────────┘
```

---

## Agent & Skill Reference

| Name | Type | Phase | Input Artifacts | Output Artifacts |
|------|------|-------|----------------|-----------------|
| **help** | reference | Any | (none) | (none — interactive guidance only) |
| **memorize** | skill | Any | User instructions, `.spec-lite/memory.md` | `.spec-lite/memory.md` |
| **todo** | skill | Any | User TODO text, `.spec-lite/TODO.md` | Updated `.spec-lite/TODO.md` |
| **explore** | agent | Any | Codebase, optional existing `docs/explore/`/`.spec-lite/memory.md` | `docs/explore/<project-name>.md`, `docs/explore/INDEX.md`, `README.md`, updated `.spec-lite/memory.md` |
| **yolo** | agent | Any | User goal, optional `.spec-lite/memory.md`, optional `.spec-lite/yolo_state.md` (resume) | End-to-end pipeline artifacts + `.spec-lite/yolo_state.md` |
| **brainstorm** | agent | 0 | User idea/problem | `.spec-lite/brainstorm.md` |
| **plan** | agent | 1 | User requirements (optionally `.spec-lite/brainstorm.md`), optional `.spec-lite/feature-summary.md` | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, updates `.spec-lite/TODO.md` |
| **plan-critic** | skill | 1.25 (manual) | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, optional `.spec-lite/brainstorm.md`, optional feature specs | `.spec-lite/reviews/plan_critique_<scope>.md`, may update `.spec-lite/TODO.md` |
| **architect** | agent | 1.5 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, user requirements | `.spec-lite/architect_<name>.md`, updates `.spec-lite/TODO.md` |
| **build-data-model** | skill | 1.5 | User description, `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, `.spec-lite/memory.md` | `.spec-lite/data_model.md` |
| **feature** | skill | 2 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, optional `.spec-lite/data_model.md`, optional `.spec-lite/feature-summary.md` | `.spec-lite/features/feature_<name>.md`, updates parent plan `Spec File`, updates `.spec-lite/TODO.md` |
| **plan-feature** | agent | 1→2 | User description, `.spec-lite/memory.md`, optional `.spec-lite/data_model.md`, optional `.spec-lite/feature-summary.md` | `.spec-lite/features/feature_<name>.md`, updates `.spec-lite/TODO.md` |
| **implement** | skill | 2.5 | `.spec-lite/features/feature_<name>.md`, `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, optional `.spec-lite/data_model.md`, optional `.spec-lite/feature-summary.md` | Working code, updated feature spec (task states), updates `.spec-lite/feature-summary.md` |
| **fix** | skill | 2 | Error logs, optional `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, optional `.spec-lite/feature-summary.md` | Fix + regression test, `.spec-lite/reviews/fix_<issue>.md` (or inline), may update `.spec-lite/feature-summary.md` |
| **devops** | skill | 2 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md` | `.spec-lite/devops/`, infra configs |
| **review-code** | skill | 3 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, `.spec-lite/features/`, source code | `.spec-lite/reviews/code_review_<name>.md` |
| **review-security** | skill | 3 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, source code, deploy configs | `.spec-lite/reviews/security_audit.md` |
| **review-performance** | skill | 3 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, source code, benchmarks | `.spec-lite/reviews/performance_review.md` |
| **write-integration-tests** | skill | 3 | `.spec-lite/features/feature_<name>.md`, `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, source code | `.spec-lite/features/integration_tests_<name>.md` |
| **write-unit-tests** | skill | 3 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, `.spec-lite/features/`, source code | `.spec-lite/features/unit_tests_<name>.md` |
| **write-readme** | skill | 4 | `.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`, optional `.spec-lite/brainstorm.md`, source code, optional `docs/explore/INDEX.md`, optional `.spec-lite/feature-summary.md` *(legacy alias: `feature_summary.md`)* | `README.md` |

---

## .spec-lite/ Directory Structure

```
.spec-lite/
├── brainstorm.md              # Ideation output
├── plan.md                    # Default plan (simple projects)
├── plan_<name>.md             # Named plans (complex projects, e.g., plan_order_management.md)
├── architect_<name>.md        # Cloud & infrastructure architecture
├── data_model.md              # Relational data model (maintained by Build Data Model skill)
├── memory.md                  # Standing instructions (maintained by Memorize skill)
├── feature-summary.md         # Current-state summary of implemented feature behavior
├── yolo_state.md              # Persistent state for YOLO pause/resume
├── TODO.md                    # Enhancement backlog (maintained by Plan agent + Feature skill + TODO skill)
├── features/
│   ├── feature_<name>.md      # Feature specifications
│   ├── integration_tests_<name>.md  # Integration test plans
│   └── unit_tests_<name>.md         # Unit test plans
├── reviews/
│   ├── plan_critique_<scope>.md # Optional manual plan critique report
│   ├── code_review_<name>.md  # Code review reports
│   ├── security_audit.md      # Security audit report
│   ├── performance_review.md  # Performance review report
│   └── fix_<issue>.md         # Fix reports
└── devops/
    └── ...                    # Infrastructure artifacts
```

Additional common non-`.spec-lite/` outputs:

- `README.md` (from Write Readme skill)
- `docs/explore/` (from Explore agent — per-project docs + `INDEX.md`)

### Manual Plan Critique

The **Plan Critic** skill is an **optional manual checkpoint** after planning. It is intentionally **not** part of YOLO or any default invocation pattern.

Use it when you want a second-pass critique before feature work or implementation begins:

- sanity-check feasibility and sequencing
- surface hidden technical complexity or missing decisions
- capture future enhancements in `.spec-lite/TODO.md` without expanding the current scope

Typical invocation:

```text
/spec.plan_critic .spec-lite/plan_<name>.md
```

---

## Memory Protocol

Every agent and skill has a **Required Context (Memory)** section that lists which artifacts it must read before starting. This ensures:

1. **Continuity**: Each agent/skill picks up where the previous one left off.
2. **Consistency**: All agents and skills work from the same source of truth (memory + plan).
3. **User Authority**: Memory and the plan are living documents — user modifications take priority.

### Memory-First Architecture

`.spec-lite/memory.md` is the **authoritative source** for cross-cutting concerns that apply to every invocation:

- **Coding Standards** — naming, formatting, error handling, immutability
- **Architecture & Design Principles** — Clean Architecture, SOLID, composition patterns
- **Testing Conventions** — framework, organization, naming, mocking, coverage
- **Logging Rules** — library, levels, format, what to log/not log
- **Security Policies** — input validation, auth, secrets, PII handling
- **Tech Stack** — language, framework, key dependencies
- **Project Structure** — directory layout, file naming patterns

Plans (`.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`) hold only **plan-specific** additions and overrides to these standing rules. Plans should NOT re-derive what memory already establishes.

### Required Context Rules

- **"mandatory"** = Must be read before starting. The agent/skill should error or warn if the artifact doesn't exist.
- **"recommended"** = Should be read if it exists. Provides context but isn't blocking.
- **"optional"** = Read if available and relevant. Nice-to-have.

### User-Modified Artifacts

Plans (`.spec-lite/plan.md` or `.spec-lite/plan_<name>.md`), memory (`.spec-lite/memory.md`), and TODO (`.spec-lite/TODO.md`) are **living documents**. Users may:

- Add instructions or constraints
- Modify priorities or ordering
- Correct architectural decisions
- Add notes or context

**All agents and skills must respect user modifications.** If the plan says "use Redis for caching" and the user adds a note "Actually, use Memcached", follow the user's instruction.

### Memory Precedence

The `.spec-lite/memory.md` file (managed by the **Memorize** skill) contains standing instructions that apply to **all** agents and skills. Every agent/skill that has `.spec-lite/memory.md` listed in its Required Context must:

1. Read `.spec-lite/memory.md` before starting work.
2. Treat each entry as a hard requirement — equivalent to a user-added instruction in the plan.
3. If a memory entry conflicts with the plan, the **memory entry wins** (it represents the user's most recent explicit preference).
4. If a plan contains an explicit override with justification, the plan's override wins for that plan's scope only.

### Bootstrap Flow

For new projects, the recommended initialization flow is:

1. `npx @abranjith/spec-lite init` — installs agents, skills, and references; collects project profile; copies stack snippets.
2. `/memorize bootstrap` — reads the project profile, config files, and stack snippets to generate a *prescriptive* `memory.md` (conventions based on best practices for the stack). Does NOT scan source code.
3. `/explore all` *(optional but recommended for existing codebases)* — deep codebase analysis that discovers actual patterns, conventions, and architecture from source code. Merges *descriptive* findings into `memory.md` alongside the bootstrap baseline. Can be expensive on large codebases.
4. `/plan` — creates a plan that references memory for cross-cutting standards, adding only plan-specific decisions.

---

## Enhancement Tracking Protocol

The `.spec-lite/TODO.md` file serves as a living backlog. Multiple agents and skills contribute to it:

| Name | TODO Interaction |
|------|-----------------|
| **Memorize** (skill) | Creates/updates `.spec-lite/memory.md` with standing instructions (can be invoked anytime) |
| **TODO** (skill) | Adds a user-requested TODO item to the correct category (asks when category is unclear) |
| **Plan** (agent) | Creates initial TODO categories based on architectural decisions |
| **Plan Critic** (skill) | Adds future enhancement ideas that should not expand the current plan scope |
| **Feature** (skill) | Adds discovered enhancements during implementation exploration |
| **Fix** (skill) | Adds follow-up items discovered during debugging |
| **Review Code** (skill) | May reference TODO items for broader refactoring needs |

### TODO Format

```markdown
## {{Category}}

- [ ] {{Description}} — _Discovered by {{agent/skill name}}, {{date}}_
- [x] {{Completed item}} — _Done in FEAT-{{id}}_
```

---

## Conflict Resolution

When agents or skills disagree or produce contradictory outputs:

### Priority Order (highest first)

1. **User-modified artifacts** — User edits to plans, memory.md, TODO.md, or feature specs always win.
2. **Standing instructions (memory.md)** — Entries in `.spec-lite/memory.md` represent the user's persistent preferences. They override plan defaults if there is a conflict.
3. **Plan constraints** — Architectural decisions in the relevant plan override individual agent/skill preferences.
4. **Evidence-based findings** — A security vulnerability found by Review Security overrides a Review Code "approve" if the code review missed it.
5. **Later-stage outputs** — Review skills (Phase 3) can override implementation skills (Phase 2) for quality concerns.

### Common Conflicts

| Conflict | Resolution |
|----------|-----------|
| Review Code approves but Review Security finds vulnerability | Security wins — fix before merge. |
| Feature implementation deviates from plan | Flag the deviation. If intentional, update the plan. If accidental, fix the implementation. |
| Review Performance recommends optimization that reduces readability | Depends on severity. If it meets SLAs, prefer readability. If it doesn't, optimize. |
| Brainstorm suggests approach X but plan chose approach Y | Plan wins — brainstorm is exploration, plan is commitment. |

---

## Invocation Patterns

### Full Pipeline (New Project)

```
memorize bootstrap → explore (optional) → brainstorm → plan → build-data-model (if data-driven) → feature (×N) → implement (×N) → [review-code, review-security, review-performance, write-unit-tests, write-integration-tests] → write-readme
```

### Feature Addition (Existing Project)

```
brainstorm (optional) → feature → implement → [review-code, write-unit-tests, write-integration-tests] → write-readme (update)
```

### Quick Feature (Focused Enhancement)

```
plan-feature → implement → [review-code, write-unit-tests, write-integration-tests]
```

### Data Modelling (Standalone or from Plan)

```
build-data-model → feature (×N) → implement (×N)
```

### Feature Implementation (Spec Already Exists)

```
implement → [review-code, write-unit-tests, write-integration-tests]
```

### Bug Fix

```
fix → [review-code]
```

### Security Hardening

```
review-security → fix (×N) → review-code
```

### Performance Optimization

```
review-performance → feature (optimization tasks) → implement → review-code → write-integration-tests
```

### Orientation / Help

```
help (anytime — no prerequisites)
```

### Codebase Discovery / Onboarding

```
explore → plan (if no plan exists) → feature / implement
```

### Autonomous End-to-End

```
yolo (drives plan → feature → implement → optional reviews/tests/docs; persists state in yolo_state.md)
```

---

## Conventions

### Artifact Naming

- Feature specs: `feature_<snake_case_name>.md`
- Integration tests: `integration_tests_<snake_case_name>.md`
- Unit tests: `unit_tests_<snake_case_name>.md`
- Plan critiques: `plan_critique_<scope>.md`
- Code reviews: `code_review_<feature_name>.md`
- Fix reports: `fix_<issue_description>.md`
- Data model: `data_model.md`
- Feature summary (current-state behavior): `feature-summary.md` *(legacy variants like `feature_summary.md` may exist in older projects)*
- YOLO state: `yolo_state.md`
- Explore output: `docs/explore/` (per-project docs + `INDEX.md`)
- IDs: FEAT-001, TASK-001.1, SEC-001, PERF-001

### Plan ↔ Feature Cross-Reference

Plans and feature specs maintain bidirectional linkage:

- **`plan.md` → feature specs** (`## 2. High-Level Features` table): The Plan agent pre-assigns FEAT-IDs and records the expected spec filename. The Feature skill must ensure the selected FEAT-ID row has the correct `Spec File` link to the generated `.spec-lite/features/feature_<name>.md` file. The `Status` column is updated only by the Implement skill.
- **`feature_*.md` → plan** (`## 1. Feature Goal` → `**Source Plan**` field): Every feature spec records which plan file it was derived from.

This round-trip reference ensures that given a plan you can enumerate all derived feature specs, and given a feature spec you can trace it back to its originating plan.

### Output Headers

Every generated artifact should include:

```markdown
<!-- Generated by spec-lite v{{version}} | skill: {{name}} | date: {{date}} -->
```

or for agent outputs:

```markdown
<!-- Generated by spec-lite v{{version}} | agent: {{name}} | date: {{date}} -->
```

Some maintained artifacts may use `updated:` instead of `date:` depending on conventions.

### Plan References

When an agent or skill references the plan, use:

```markdown
> Per plan.md: "{{quoted text from plan}}"
> Per plan_order_management.md: "{{quoted text from named plan}}"
```

---

## Referencing Artifacts by Name

In complex projects, users need clear ways to tell agents and skills which artifact to use.

### Plans

- **Default**: `.spec-lite/plan.md` — used when there's only one plan.
- **Named**: `.spec-lite/plan_<name>.md` (e.g., `plan_order_management.md`, `plan_catalog.md`) — used in complex repos with multiple domains.
- **How users reference them**:
  - "Use the order-management plan" → reads `.spec-lite/plan_order_management.md`
  - "Plan based on `.spec-lite/plan_catalog.md`" → explicit file path
  - If only one plan exists, agents/skills use it automatically without asking.
  - If multiple plans exist and the user doesn't specify, agents/skills MUST ask which plan to use.

### Plan Critiques

- **File**: `.spec-lite/reviews/plan_critique_<scope>.md`
- **Created by**: **Plan Critic** skill.
- **How users reference it**: "Critique `plan_order_management.md`", "Review the plan before implementation", or by explicit file path.
- **Default behavior**: Manual-only checkpoint. It is not auto-invoked by YOLO or the default pipeline.

### Brainstorms

- **File**: `.spec-lite/brainstorm.md` (singular — not auto-included in planning).
- **How users reference it**: "Plan based on the brainstorm" or "Use brainstorm.md for context."
- **Default behavior**: Agents and skills ignore the brainstorm unless the user explicitly says to use it.

### Features

- **File**: `.spec-lite/features/feature_<name>.md` (e.g., `feature_user_management.md`).
- **How users reference them**:
  - By name: "Implement the user management feature" → finds `feature_user_management.md`
  - By file: "Implement `.spec-lite/features/feature_user_management.md`"
  - By glob: "Implement all features" → lists `.spec-lite/features/feature_*.md` and works through them
  - By ID: "Continue from FEAT-003" → finds the feature spec containing FEAT-003

### Data Model

- **File**: `.spec-lite/data_model.md` (singular — one per project, like `memory.md`).
- **Created by**: **Build Data Model** skill.
- **How users reference it**: "Design a data model" or "Update the data model for orders".
- **Default behavior**: Downstream agents and skills (Feature, Implement, Review Code, etc.) read `data_model.md` if it exists. It is not mandatory — projects without persistent data don't need it.

### Feature Summary

- **File**: `.spec-lite/feature-summary.md` *(legacy: `.spec-lite/feature_summary.md` may still appear in older projects)*.
- **Maintained by**: primarily **Implement** and **Fix** skills.
- **How users reference it**: "update feature summary", "what's the current behavior of implemented features?"
- **Default behavior**: Plan/Feature/Implement/Fix/Write Readme may read it to align new work with current implemented behavior.

### YOLO State

- **File**: `.spec-lite/yolo_state.md`.
- **Maintained by**: **YOLO** agent.
- **How users reference it**: "pause YOLO", "resume YOLO", "continue YOLO".
- **Default behavior**: Used only by YOLO orchestration runs; ignored by other agents and skills.

### General Rule

When a user's reference is ambiguous (e.g., "use the plan" when multiple plans exist), agents and skills should list the available options and ask the user to pick one. Never guess.

---

## What's Next? — Pipeline Continuity

Every agent and skill includes a **"What's Next? (End-of-Task Output)"** section that instructs it to suggest the logical next step(s) when it finishes its work. This creates a guided flow through the pipeline — users can copy-paste the suggested command to continue without consulting this document.

### Flow Summary

| When this finishes... | It suggests... |
|---|---|
| **Brainstorm** (agent) | Plan (create a plan from the brainstorm); Memorize (if no memory.md) |
| **Plan** (agent) | Build Data Model (if plan has data model); Feature (break down each feature individually); Memorize (if no memory.md) |
| **Build Data Model** (skill) | Feature (break down features); Implement (data layer); Memorize (capture conventions) |
| **Feature** (skill) | Implement (the feature spec); Feature (next feature from the plan) |
| **Implement** (skill) | Write Unit Tests; Review Code; Implement (next feature); Write Integration Tests (when all done) |
| **Write Unit Tests** (skill) | Review Code; Write Integration Tests; Write Unit Tests (next feature) |
| **Review Code** (skill) | Fix (if issues found); Write Integration Tests; Review Security; Technical Docs |
| **Write Integration Tests** (skill) | Review Security; Review Performance; Technical Docs |
| **Review Performance** (skill) | Fix (if critical findings); Review Security; Technical Docs |
| **Review Security** (skill) | Fix (if vulnerabilities found); Review Performance; Technical Docs; Write Readme |
| **Fix** (skill) | Re-run originating review/test; Write Unit Tests; Continue implementation |
| **Write Readme** (skill) | DevOps; Review Security; Done |
| **DevOps** (skill) | Review Security; Write Readme (update); Technical Docs |
| **Memorize** (skill) | Explore (recommended for existing projects); Plan (if new project); Build Data Model (if data-driven); Feature (if plan exists) |
| **Explore** (agent) | Plan (create plan from discovered codebase); Feature (if a plan already exists); Memorize bootstrap (if only descriptive conventions exist) |
| **YOLO** (agent) | Resume/pause controls, or post-run hardening/docs tasks based on remaining optional phases |

### Format Convention

All agents and skills use the same output format for consistency:

```
> **What's next?** {{context-specific message}}. Here are your suggested next steps:
>
> 1. **{{Step description}}**: *"{{copy-pasteable command}}"*
> 2. **{{Step description}}**: *"{{copy-pasteable command}}"*
```

Commands are provider-agnostic natural language — the user copies the quoted text and pastes it into their chat. Agents and skills should use actual project/feature/plan names, not placeholders.

---

**This document is the meta-layer. Individual AGENT.md and SKILL.md files contain their detailed instructions. Use the [help](help.md) reference for interactive guidance on which agent or skill to invoke.**
