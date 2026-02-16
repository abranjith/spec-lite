<!-- spec-lite v1.0 | prompt: orchestrator | updated: 2026-02-15 -->

# Spec-Lite: Orchestrator & Workflow Guide

This document is the **meta-layer** that ties all spec-lite agents together. It defines the pipeline, the rules of engagement, and how agents collaborate to turn an idea into a well-engineered product.

> **Audience**: Engineers, AI agents, and anyone using the spec-lite prompt collection.

---

## 1. What Is Spec-Lite?

Spec-lite is a lightweight, modular, LLM-agnostic collection of prompt files for structured software engineering. Each prompt defines a specialist agent that handles one phase of the development lifecycle. The prompts work with **any** LLM or coding agent — copy the relevant prompt into your system prompt, fill in the Project Context block, and attach the relevant `.spec/` artifacts as context.

**Design Principles**:
- **Lightweight**: No frameworks, no dependencies, no lock-in. Just markdown prompts.
- **Modular**: Use one agent or all of them. Skip what you don't need.
- **Unopinionated**: Adapts to any project type, language, or tech stack via the Project Context block.
- **Finite-scoped**: Each agent has a clear objective, defined inputs, and a concrete output artifact.

---

## 2. Agent Pipeline

The agents form a directed acyclic graph (DAG). Not every project needs every agent. The pipeline below shows the full flow; skip agents that don't apply.

```
                          ┌──────────────┐
                          │  Brainstorm  │ ← Optional (skip if requirements are clear)
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │   Planner    │ ← Core (every project needs a plan)
                          └──────┬───────┘
                                 │
                     ┌───────────┼───────────┐
                     ▼           ▼           ▼
               ┌──────────┐ ┌──────────┐ ┌──────────┐
               │Feature A │ │Feature B │ │Feature N │  ← Parallel per feature
               └────┬─────┘ └────┬─────┘ └────┬─────┘
                    │             │             │
                    ▼             ▼             ▼
          ┌─────────────────────────────────────────────┐
          │        Review Gate (per feature)             │
          │  ┌─────────────┐ ┌──────────┐ ┌───────────┐ │
          │  │ Code Review │ │ Security │ │Performance│ │ ← Run in parallel
          │  └─────────────┘ └──────────┘ └───────────┘ │
          └──────────────────────┬──────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
          ┌──────────────┐ ┌──────────┐ ┌──────────┐
          │  Integration │ │  DevOps  │ │ Fix/     │  ← As needed
          │    Tests     │ │          │ │ Refactor │
          └──────┬───────┘ └────┬─────┘ └────┬─────┘
                 │              │             │
                 └──────────────┼─────────────┘
                                ▼
                    ┌───────────────────────┐
                    │    Documentation      │
                    │  ┌─────────┐ ┌──────┐ │
                    │  │Tech Docs│ │README│ │  ← Run in parallel
                    │  └─────────┘ └──────┘ │
                    └───────────────────────┘
```

### Agent Summary

| Agent | Prompt File | Input | Output | Required? |
|-------|-------------|-------|--------|-----------|
| **Brainstorm** | `brainstorm.md` | User's idea | `.spec/brainstorm.md` | Optional |
| **Planner** | `planner.md` | Brainstorm output or user requirements | `.spec/plan.md` | **Yes** |
| **Feature** | `feature.md` | One feature from plan | `.spec/features/feature_<name>.md` | **Yes** |
| **Code Review** | `code_review.md` | Feature spec + code | `.spec/reviews/code_review_<name>.md` | Recommended |
| **Security Audit** | `security_audit.md` | Feature spec + code | `.spec/reviews/security_audit_<scope>.md` | Recommended |
| **Performance Review** | `performance_review.md` | Feature spec + code | `.spec/reviews/performance_review_<scope>.md` | Optional |
| **Integration Tests** | `integration_tests.md` | Feature spec + plan | `tests/` (project dir) | Recommended |
| **DevOps** | `devops.md` | Plan + codebase | Project files (Dockerfile, CI configs, etc.) | Optional |
| **Fix / Refactor** | `fix.md` | Bug report / code smells | Fix + verification | As needed |
| **Technical Docs** | `technical_docs.md` | Plan + feature specs | `docs/technical_architecture.md` | Recommended |
| **README** | `readme.md` | Plan + feature specs | `README.md` + optional `docs/user_guide.md` | **Yes** |

---

## 3. When To Skip Agents

- **Skip Brainstorm** when the user already has clear requirements or a written spec.
- **Skip Performance Review** for simple CRUD apps, scripts, or prototypes where performance isn't a concern.
- **Skip Security Audit** for local-only tools with no network access, no auth, and no sensitive data.
- **Skip DevOps** for single-file scripts or projects that don't need containerization or CI/CD.
- **Skip Integration Tests** for throwaway prototypes (but not for production code).
- **Skip Fix/Refactor** for greenfield projects (it's for existing codebases).

---

## 4. Conflict Resolution Rules

Conflicts arise when agent instructions, the plan, and user preferences disagree. These rules apply **globally** across all agents. Each agent prompt also includes agent-specific conflict guidance.

### Priority Order (Highest → Lowest)

1. **User's explicit instruction** — Always wins. If the user says "use tabs", use tabs, even if the plan says spaces.
2. **The Plan (`.spec/plan.md`)** — The source of truth for technical decisions. All downstream agents defer to it.
3. **Agent's own expertise** — The agent's instructions and best practices apply when the plan and user are silent on a topic.
4. **Defaults from the prompt** — The fallback when nothing else applies.

### Specific Rules

| Conflict | Resolution |
|----------|------------|
| User preference vs Plan | Follow user. Update the plan to reflect the change. |
| Review finding vs Plan | Flag the contradiction to the user. Do not silently override the plan. |
| Agent instruction vs User preference | Follow user. Note the deviation if it risks quality. |
| Two agents disagree | Escalate to the user with both positions clearly stated. |
| Plan is silent on a topic | Agent uses professional judgment and documents the decision. |

### Feedback Loops

- **Review → Feature**: If a code review, security audit, or performance review finds issues, the findings are fed back to the Feature Agent for rework. The Feature Agent updates the feature spec and code, then re-submits for review.
- **Review → Plan**: If a review reveals a **fundamental architectural flaw**, escalate to the user. The Planner Agent may need to revise `.spec/plan.md`.
- **Feature → Plan**: If implementing a feature reveals that the plan is incomplete or contradictory, the Feature Agent flags it rather than guessing.

---

## 5. The `.spec/` Directory

All planning and review artifacts live in `.spec/` at the project root. Implementation artifacts (tests, docs, actual code) go in the project's natural directories.

```
project-root/
├── .spec/
│   ├── brainstorm.md                          # Brainstorm output
│   ├── plan.md                                # The master plan
│   ├── features/
│   │   ├── feature_user_management.md         # Feature breakdown
│   │   ├── feature_billing.md
│   │   └── ...
│   └── reviews/
│       ├── code_review_user_management.md     # Code review
│       ├── security_audit_auth.md             # Security audit
│       ├── performance_review_data_import.md  # Performance review
│       └── ...
├── tests/                                     # Integration tests (project dir)
├── docs/                                      # Technical & user docs (project dir)
├── README.md                                  # Project README (project root)
└── ... (source code)
```

### Versioning

Spec-lite relies on **git** for versioning. When a plan or review is updated, commit the change with a meaningful message. No file-level backup copies (e.g., `plan_v2.md`) — use git history to track revisions.

> **Tip**: Add `.spec/` to version control. These artifacts are valuable project documentation, not throwaway notes.

---

## 6. How To Use Spec-Lite

### With Any LLM (ChatGPT, Claude, Gemini, local models, etc.)

1. **Copy** the relevant agent's prompt file into your LLM's system prompt (or paste it at the start of the conversation).
2. **Fill in** the Project Context block at the top of the prompt with your project details.
3. **Attach** relevant `.spec/` files as context (e.g., when running the Feature Agent, attach `.spec/plan.md`).
4. **Interact** — the agent will follow its process and produce the defined output.

### With Coding Agents (Cursor, Copilot, Aider, etc.)

1. Place the prompt files in your project's `prompts/` or `.spec/prompts/` directory.
2. Reference the relevant prompt when starting a task (e.g., "Follow the instructions in `prompts/feature.md` to implement User Management").
3. The agent reads the prompt, reads the `.spec/` artifacts, and produces the output.

### Recommended Workflow

```
1. [Optional] Run Brainstorm Agent → produces .spec/brainstorm.md
2. Run Planner Agent            → produces .spec/plan.md
3. For each feature in the plan:
   a. Run Feature Agent         → produces .spec/features/feature_<name>.md
   b. Implement the feature (you or a coding agent)
   c. Run Code Review Agent     → produces .spec/reviews/code_review_<name>.md
   d. Run Security Audit Agent  → produces .spec/reviews/security_audit_<name>.md
   e. [Optional] Run Perf Review → produces .spec/reviews/performance_review_<name>.md
   f. Fix issues found in reviews (use Fix Agent if needed)
   g. Run Integration Tests Agent → produces test files in tests/
4. Run DevOps Agent             → produces Dockerfile, CI configs, etc.
5. Run Technical Docs Agent     → produces docs/technical_architecture.md
6. Run README Agent             → produces README.md + optional docs/user_guide.md
```

---

## 7. Prompt Metadata

Every spec-lite prompt includes an HTML comment at the top with version metadata:

```html
<!-- spec-lite v1.0 | prompt: <name> | updated: YYYY-MM-DD -->
```

Generated artifacts should stamp the prompt version that produced them:

```markdown
<!-- Generated by spec-lite v1.0 | agent: planner | date: YYYY-MM-DD -->
```

This enables traceability: you always know which version of a prompt produced which artifact.

---

## 8. Customization

Spec-lite is designed to be forked and adapted. Common customizations:

- **Add project-specific conventions** to the Project Context block in each prompt.
- **Remove agents** you don't need (delete the prompt file).
- **Add new agents** following the canonical template (see any existing prompt for the structure).
- **Modify output paths** if your project has a different directory convention.

The only rule: **keep each agent focused on one concern**. A prompt that tries to do everything will do nothing well.
