# Documentation

Documentation is a first-class output, not an afterthought. You choose where docs
live and how deep they go; roles then write only that set, from verified code.

## Settings

Initialization stores documentation behavior in `.spec-lite.json`:

```json
{
  "documentation": {
    "directory": "docs",
    "level": "technical",
    "updateWithDevelopment": true
  }
}
```

| Key | Values | Meaning |
|---|---|---|
| `directory` | any repository-relative path | Where generated documentation is written |
| `level` | `technical`, `full` | How much of the document set is generated |
| `updateWithDevelopment` | `true`, `false` | When true, Implement and Fix request a surgical documentation update after code changes |

`spec-lite init --skip-profile` uses `docs`, `technical`, and
`updateWithDevelopment: false`. If the section is missing entirely, run
`spec-lite update` to collect it.

## The configured document set

| Level | Documents |
|---|---|
| `technical` | Repository-root `README.md` and `<docs-dir>/architecture.md` |
| `full` | The above, plus `<docs-dir>/quickstart.md`, `<docs-dir>/usage.md`, and exactly one `<docs-dir>/features/<feature>.md` per implemented feature |

Markdown only. The Document roles deliberately do not create extra indices,
overview files, per-module documents, or changelogs — doc sprawl is what makes
documentation go stale.

## Modes

| Invocation | Behavior |
|---|---|
| `document` or `document full` | Discover the current codebase and generate the configured set |
| `document update [scope]` | Diff code against existing docs and surgically refresh only what changed |
| `document architecture` | Run the design writer only |
| `document feature <name>` | Document exactly one implemented feature |
| `document usage` | Write quickstart and usage docs (level `full`) |
| `document readme` | Refresh the README after reading the existing set |

`document` orchestrates; the writers do the work, one at a time, so two writers
never touch the same file: Design → Feature (once per feature) → Usage → README
last, so it can index the finished set.

Update mode resolves what to refresh from the supplied scope and the feature's
`changeset.json` (see [Hooks](hooks.md)), then invokes only the affected writers.

## Guarantees

- Documents what exists — Architect designs what *should* exist.
- Never invents commands, outputs, APIs, license terms, contributing policy,
  features, or architecture.
- Preserves content that was clearly authored by a person; replaces stale
  generated claims and removes generated entries for deleted code.
- Surfaces a conflict instead of overwriting when authorship is uncertain.

## Related

- [Agents and skills](agents-and-skills.md) — the Document writer family
- [Architecture](../architecture.md#configuration) — the rest of `.spec-lite.json`
- [Hooks](hooks.md) — the changeset that drives update mode
