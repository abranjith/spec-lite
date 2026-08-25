# Memory and project state

`.spec-lite/memory.md` is the authority for standing project instructions —
coding standards, architecture rules, testing conventions, security requirements.
Every role reads it and treats its entries as hard requirements.

## Seeding memory

```text
memorize bootstrap
```

Bootstrap seeds `memory.md` from what the repository already proves: manifests,
configuration, recurring code patterns, the selected stack baselines, and
official documentation for the stack.

## Capturing conventions as work happens

Planning and delivery roles may capture up to three durable conventions per run.
Captured entries are date-tagged and reported back to you, and conflicts are
never silently resolved — a role that finds a contradiction surfaces it instead
of picking a side. Use Memorize to override, merge, or reorganize entries.

```text
Remember that all timestamps are UTC and all API errors use the shared error envelope.
```

## What to commit

```text
.spec-lite/
├── memory.md                  Standing project conventions
├── brainstorm.md              Product discovery context
├── plan.md                    Default technical blueprint
├── plan_<name>.md             Optional named blueprint
├── hooks.json                 Project hook registry
├── features/
│   ├── FEAT-###-<name>/       One directory per feature
│   │   ├── spec.md            The feature spec
│   │   ├── changeset.json     Hook-captured file changes — the review scope
│   │   └── hooks.log.jsonl    Append-only audit of every hook run
│   ├── unit_tests_<name>.md
│   └── integration_tests_<name>.md
├── reviews/                   Plan and implementation reviews
├── stacks/                    Selected stack baselines
├── data_model.md              Relational model, when used
├── TODO.md                    Deferred enhancement backlog
├── yolo_state.md              Resumable autonomous-run state
└── tools/                     Project-specific context helpers
```

Commit these files with the related code, along with `.spec-lite.json`. Two
things follow from that:

- decisions, scope, and review history become reviewable in pull requests;
- another developer — or a different AI harness — can continue the work with the
  same state, because no role depends on a chat transcript.

## Stable feature IDs

`FEAT-###` identifiers are allocated once, as the highest existing number plus
one, and are never renumbered. The same ID identifies a feature in the plan, its
spec directory, its changeset, its tests, its review, and every hook payload.

## Project tools

`.spec-lite/tools/` holds small project-specific scripts that gather live context
— migration status, failing tests, service health. Roles list the directory, read
each script's header comment, and run the relevant ones before and during work.
Roles never modify these tools; the Tool Helper skill owns changes to them.

## Related

- [Agents and skills](agents-and-skills.md) — Memorize, Todo, and Tool Helper
- [Review](review.md) — how committed changesets become review scope
- [Architecture](../architecture.md#project-state) — where this sits in the design
