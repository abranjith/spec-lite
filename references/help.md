---
name: help
description: User-facing catalog and workflow navigator for spec-lite agents and skills.
metadata:
  author: spec-lite
---

# spec-lite Help

Use this navigator to choose a role. For ownership, precedence, naming, IDs, and cross-role contracts, see the [Orchestrator](orchestrator.md).

<!-- project-context-start -->
## Project Context (Customize per project)

- **Project Type**: (optional)
- **Language(s)**: (optional)
- **Current Stage**: idea | planning | implementation | validation | documentation

<!-- project-context-end -->

## Agents

| Agent | Use when | Primary output |
|---|---|---|
| **Brainstorm** | Turn a vague idea into an actionable vision | `.spec-lite/brainstorm.md` |
| **Plan** | Create a complete technical blueprint and feature table | `.spec-lite/plan.md` or `plan_<name>.md` |
| **Plan Feature** | Specify one focused enhancement without a full plan | `.spec-lite/features/FEAT-###-<name>/spec.md` |
| **Architect** | Design future cloud/system architecture and tradeoffs | `.spec-lite/architect_<name>.md` |
| **YOLO** | Run the confirmed end-to-end pipeline autonomously | All pipeline artifacts + `yolo_state.md` |

## Skills

| Skill | Use when | Primary output |
|---|---|---|
| **Feature** | Break plan rows into executable vertical slices | `features/FEAT-###-<name>/spec.md` + plan Spec File |
| **Implement** | Execute one feature, a plan, or review findings | Code, tests, state, changeset.json, feature summary |
| **Review** | Audit completed files/features/plans across code, security, and performance | `reviews/review_<scope>.md` |
| **Fix** | Diagnose and repair a bug/regression/review finding | Minimal fix + regression tests/report |
| **Write Unit Tests** | Expand isolated behavior coverage | Unit-test spec and tests |
| **Write Integration Tests** | Verify seams and system boundaries | Integration-test spec and tests |
| **Build Data Model** | Turn domain concepts into a relational schema | `.spec-lite/data_model.md` |
| **DevOps** | Add deployment, CI/CD, containers, and environments | Infrastructure/configuration files |
| **Memorize** | Add, override, deduplicate, or bootstrap standing rules | `.spec-lite/memory.md` |
| **Plan Critic** | Pressure-test a plan before implementation | `reviews/plan_critique_<scope>.md` |
| **TODO** | Curate an explicit backlog item | `.spec-lite/TODO.md` |
| **Tool Helper** | Create/update live-context shell tools | `.spec-lite/tools/<tool>.sh` |
| **Document** | Orchestrate full, update, or targeted documentation | Configured doc set |
| **Document Design** | Describe current architecture with Mermaid | `<docs-dir>/architecture.md` |
| **Document Feature** | Document one implemented user feature | `<docs-dir>/features/<feature>.md` |
| **Document Usage** | Write verified quickstart and usage | `<docs-dir>/quickstart.md`, `usage.md` |
| **Document README** | Create the concise top-level index/front door | `README.md` |

## Common Workflows

### New project

```text
spec-lite init → memorize bootstrap → brainstorm (optional) → plan
→ build data model (if persistent) → feature → implement
→ integration tests → review → document full
```

### Existing codebase documentation

```text
spec-lite init → document full
```

Document discovers current topology, can ingest legacy `docs/explore/`, and generates only the configured strict document set.

### Focused feature

```text
plan feature → implement → review feature <name> → document update <name>
```

### Planned multi-feature delivery

```text
feature plan mode → implement plan mode → integration tests
→ review plan <plan-file> → document full/update
```

### Bug or review remediation

```text
fix <symptom or REV-ID> → rerun failing test/review scope → document update (if behavior changed)
```

### Data-first design

```text
plan → build data model → feature → implement
```

### Fully autonomous

```text
yolo <goal> → explicitly confirm → pause/resume through .spec-lite/yolo_state.md
```

## Choosing Review Scope

- `review files <paths/globs>` for an exact patch or module.
- `review feature <name>` after the feature is fully implemented and has a captured `changeset.json`.
- `review plan [<plan-file>]` for all completed features; incomplete rows are listed and skipped.

Every review covers correctness/testing, security, and performance. Use **Plan Critic** instead when code has not been implemented yet.

## Documentation Levels

- `technical`: README + architecture/design.
- `full`: technical + quickstart, usage, and one file per implemented feature.
- `updateWithDevelopment`: Implement/Fix invoke surgical document updates when enabled.

Run `spec-lite update` to migrate older projects to documentation settings and current prompts.

## Feature IDs

All new plans and feature specs share immutable `FEAT-###` IDs. Older Plan Feature specs may retain `FEAT-FP-###`; updates preserve those IDs, hooks resolve them normally, and their numeric suffixes participate in allocating the next canonical `FEAT-###`. Gaps are never reused.

## Need Orientation?

State what exists and what you want next, for example:

- “I have an idea but no plan.”
- “I have `plan_checkout.md`; generate all missing feature specs.”
- “Review feature checkout.”
- “Document this existing repository at full level.”
- “Resume YOLO.”

Help should inspect relevant `.spec-lite` artifacts, identify the current stage, and recommend only the next one or two useful roles. It does not create implementation artifacts itself.
