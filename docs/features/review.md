# Review

One consolidated review covers correctness, security, performance, and testing in
a single pass, over a scope that is resolved deterministically rather than
guessed. Review runs after code exists; [Plan Critic](agents-and-skills.md) is
the separate pre-implementation checkpoint.

## Scopes

Review accepts exactly one scope form:

```text
review files <paths/globs>
review feature <name>
review plan [plan-file]
```

| Invocation | Files reviewed | Rejected when |
|---|---|---|
| `review files <paths/globs>` | Exactly the named or matched files | No file exists or matches |
| `review feature <name>` | The feature's `changeset.json` entries | Any State Tracking task is incomplete, or no scope is resolvable |
| `review plan [<plan-file>]` | Union of each `[x] Complete` feature's changeset | No feature is complete; incomplete features are listed and skipped |

Resolved paths are normalized and deduplicated, and generated output,
dependencies, lockfiles, and migrations are excluded unless you explicitly
include them. The final scope is listed before analysis begins.

## Where the scope comes from

Feature and plan review use each feature's hook-captured
`.spec-lite/features/FEAT-###-<name>/changeset.json`. That file is written by the
built-in changeset hooks during Implement and Fix — see [Hooks](hooks.md#built-in-hooks).

A `changeset.json` is a diff anchored to the baseline captured before the run's
edits began, so it describes exactly this run's work. Review never infers scope
from raw git history or file naming; for specs created before hooks existed, it
falls back to the spec's manually maintained `## Touched Files` list.

## Output

Every run produces one report at `.spec-lite/reviews/review_<scope>.md`
containing:

- findings numbered in one global sequence (`REV-001`, `REV-002`, …), ordered
  Critical → High → Medium → Low;
- severity, location, evidence, and a concrete remediation target per finding;
- an approval verdict.

| Verdict | When |
|---|---|
| **Request changes** | Any Critical or High finding exists |
| **Approve with suggestions** | Findings are only Medium/Low |
| **Approve** | No actionable findings |

Review recommends changes; it never modifies production code. Apply the findings
with [Fix](agents-and-skills.md) or with Implement's Review Mode:

```text
Implement Critical and High findings from .spec-lite/reviews/review_checkout.md
```

## Automating what happens next

Review emits `review.post` and `review.verdict` as lifecycle events, and
`review.verdict` carries `${verdict}` and `${summary}`. That is the routing
signal — subscribe to it to notify a channel, open an issue, or hand off to Fix
automatically. See [Hooks](hooks.md#more-examples).

## Related

- [Agents and skills](agents-and-skills.md) — Review, Fix, and Plan Critic in the catalog
- [Hooks](hooks.md) — how `changeset.json` is captured
- [Memory and project state](memory.md) — committing reviews with the code
