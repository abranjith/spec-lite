# Agents and skills

Agents are autonomous specialist personas. Skills are focused, repeatable
workflows that can be auto-discovered or explicitly selected. Both are rendered
from the same Markdown sources into whatever format your harness expects.

Use only the roles a task needs — nothing here is a required checklist.

## Agents

| Source | Typical selector | Persona |
|---|---|---|
| `brainstorm` | `spec.brainstormer` | Curious product partner who turns a rough idea into a concrete, testable vision. |
| `plan` | `spec.planner` | Pragmatic technical planner who converts requirements into an implementation-ready blueprint. |
| `plan-feature` | `spec.feature_planner` | Focused feature designer who scopes one enhancement without requiring a full project plan. |
| `architect` | `spec.architect` | Systems architect who designs cloud topology, data strategy, reliability, and scale. |
| `yolo` | `spec.yolo` | Autonomous delivery coordinator who runs the full workflow with checkpoints and resumable state. |

## Skills

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

Two reference prompts ship alongside them: `help` is the user-facing catalog, and
`orchestrator` defines the shared precedence, naming, feature-ID, memory, and
handoff contracts.

## Selecting a role in each harness

| Harness | Agent selection | Skill selection |
|---|---|---|
| GitHub Copilot | Select `spec.<agent>` from the agent picker | Describe the task for auto-discovery, select the generated agent, or use the corresponding project prompt |
| Claude Code | Select `spec.<agent>`; project installs also provide `/spec.<verb>` commands | Select the generated specialist agent such as `spec.implementer`, or use the project command |
| OpenAI Codex | Invoke the `spec.<agent>` subagent | Ask Codex to use the skill by name, such as `spec-implement` |
| Pi | Use `/spec.<verb>` | Use `/skill:spec-<name>` or allow Pi to auto-discover it |
| Generic | Open `.spec-lite/prompts/spec.<verb>.md` | Copy the matching prompt into the LLM, or create a combined bundle with `export` |

## Example prompts

Suppose you are building a small shared grocery-list web app with real-time
updates and email invitations. Select the named role, then send a short prompt
like these.

### Agents

| Select | Example prompt |
|---|---|
| `spec.brainstormer` | "Turn this shared grocery-list idea into a concise product vision. Focus on the smallest useful first release." |
| `spec.planner` | "Plan the grocery-list app from `.spec-lite/brainstorm.md` using TypeScript, React, and PostgreSQL." |
| `spec.feature_planner` | "Create one self-contained feature spec for inviting another person to a grocery list." |
| `spec.architect` | "Design a low-cost production architecture for this app, including real-time updates, email delivery, backups, and scaling." |
| `spec.yolo` | "Build the scoped MVP from the approved requirements. Stop at the defined checkpoints and keep resumable state." |

### Skills

| Select or invoke | Example prompt |
|---|---|
| `spec-feature` | "Create feature specs for every incomplete feature in `.spec-lite/plan.md`." |
| `spec-implement` | "Implement `.spec-lite/features/FEAT-001-shared_lists/spec.md` and verify every task." |
| `spec-review` | "Review feature `shared_lists` after implementation." |
| `spec-fix` | "The second browser does not receive list updates. Diagnose the root cause, fix it, and add a regression test." |
| `spec-write-unit-tests` | "Add unit tests for the invitation service, including expired, duplicate, and malformed tokens." |
| `spec-write-integration-tests` | "Test the invitation flow across the API, database, email adapter, and acceptance endpoint." |
| `spec-document` | "Update all configured documentation to match the implemented MVP." |
| `spec-document-design` | "Document the current architecture and real-time update flow." |
| `spec-document-feature` | "Document the implemented shared-list invitation feature." |
| `spec-document-usage` | "Write a verified quickstart and user guide for creating and sharing a list." |
| `spec-document-readme` | "Refresh the README with the working setup commands and current feature list." |
| `spec-memorize` | "Remember that all timestamps use UTC and all API errors use the shared error envelope." |
| `spec-plan-critic` | "Pressure-test `.spec-lite/plan.md` before implementation, especially the real-time sync and authorization design." |
| `spec-build-data-model` | "Design the relational model for users, lists, memberships, items, invitations, and audit events." |
| `spec-devops` | "Add Docker, CI, preview deployments, production secrets guidance, and database migration checks." |
| `spec-todo` | "Add offline editing and push notifications to the product backlog without changing the current MVP." |
| `spec-tool-help` | "Create a project tool that reports migration status and failed tests for use by other spec-lite roles." |

## Stack baselines

Fourteen stack baselines ship with the CLI and are installed into
`.spec-lite/stacks/` for the stacks a project selects: TypeScript, Python, Java,
.NET, Go, Rust, Kotlin, Swift, C/C++, PHP, Ruby, React, Vue, and Angular. They
give planning and implementation roles conventional defaults for their ecosystem
without hard-coding them into every prompt.

## Related

- [Quickstart](../quickstart.md) — installing the roles and running a first workflow
- [Review](review.md) · [Documentation](documentation.md) · [Memory](memory.md)
- [CLI reference](../usage.md#export) — bundling roles into one portable Markdown file
