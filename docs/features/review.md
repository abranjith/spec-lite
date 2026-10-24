# Review

One consolidated review covers correctness, security, performance, testing, and
dependency vulnerabilities in a single pass, over a scope resolved
deterministically. Package checks use live
[GitHub Advisories](https://github.com/advisories) by default and include practical
fix and validation guidance. Review runs after code exists;
[Plan Critic](agents-and-skills.md) is the separate pre-implementation checkpoint.

## Scopes

Review accepts exactly one scope form:

```text
review files <paths/globs>
review feature <name>
review plan [plan-file]
review change <name>
review fix <issue>
review dependencies [paths/globs]
```

| Invocation | Files reviewed | Rejected when |
|---|---|---|
| `review files <paths/globs>` | Exactly the named or matched files | No file exists or matches |
| `review feature <name>` | The feature's `changeset.json` entries | Any State Tracking task is incomplete, or no scope is resolvable |
| `review plan [<plan-file>]` | Union of each `[x] Complete` feature's changeset | No feature is complete; incomplete features are listed and skipped |
| `review change <name>` | The changeset of an Implement Change Mode run, judged against its change record `.spec-lite/reviews/chg_<name>.md` | The changeset is missing or empty |
| `review fix <issue>` | The changeset of a fix made without `--feature`, judged against its fix report `.spec-lite/reviews/fix_<issue>.md` | The changeset is missing or empty, or the fix targeted a feature (use `review feature`) |
| `review dependencies [<paths/globs>]` | Named/matched manifests or lockfiles and their dependency graphs; all project manifests/lockfiles under the workspace root when paths are omitted | Explicit paths do not exist or match |

Resolved paths are normalized and deduplicated. For source review, generated
output, dependencies, lockfiles, and migrations are excluded unless you
explicitly include them. The final scope is listed before analysis begins.

Dependency checks read the owning manifests, workspace configuration, and
lockfiles as separately listed evidence, even when lockfiles are excluded from
source review. This preserves the source scope while checking direct/transitive
and runtime/development/build dependencies. Dependency-only review discovers
project manifests and lockfiles while excluding generated, vendor, and installed
dependency directories.

## Vulnerability reviews

Dependency vulnerability checks run by default for files, feature, and plan
reviews. They also run when you explicitly ask the Review skill or reviewer
subagent for vulnerability findings. For example:

```text
review dependencies
review dependencies package.json package-lock.json
Use the reviewer subagent to review vulnerable packages and suggest fixes.
Review feature checkout with a focus on dependency vulnerability findings.
```

Without another scope, a natural-language package vulnerability request maps to
`review dependencies`. An explicit vulnerability-only request limits the review
to that focus and records unrelated dimensions as Not reviewed. Merely asking
to include vulnerabilities retains the consolidated review.

Review inventories resolved versions from lockfiles or an existing dependency
graph, gathers evidence with available read-only audit tools, and verifies
candidate findings against the selected advisory source. You can explicitly
choose another source or skip a check; the report records that choice. Missing
tools, unresolved versions, unavailable advisories, and partial coverage are
reported as limitations rather than clean results. No package manifests means
the dependency check is Not applicable, with an explanation.

## Where the scope comes from

Feature and plan review use each feature's hook-captured
`.spec-lite/features/FEAT-###-<name>/changeset.json`. That file is written by the
built-in changeset hooks during Implement and Fix — see [Hooks](hooks.md#built-in-hooks).

Work without a feature has its own changeset in `.spec-lite/reviews/changeset/`:
`chg_<name>.json` for a Change Mode run, read by `review change`, and
`fix_<issue>.json` for a fix without `--feature`, read by `review fix`. A fix
made with `--feature` joins that feature's `changeset.json` instead, so
`review feature` covers it.

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
- a dependency coverage section naming manifests/lockfiles, advisory source,
  lookup timestamp, commands/results, and limitations;
- package findings with resolved versions, dependency paths, GHSA/CVE links,
  affected ranges, advisory severity, and verified fixed targets;
- a prioritized remediation plan explaining direct upgrades, transitive parent
  upgrades, lockfile changes, compatibility risks, mitigations when no patch
  exists, and validation steps;
- relevant ongoing practices such as consistent lockfiles, CI audits, automated
  security-update proposals, and documented exceptions;
- an approval verdict.

| Verdict | When |
|---|---|
| **Request changes** | Any Critical or High finding exists |
| **Approve with suggestions** | Findings are only Medium/Low, or required checks are incomplete/unavailable (verdict prominently qualified) |
| **Approve** | No actionable findings and required checks are complete or Not applicable; user-directed skips explicitly limit the verdict |

Confirmed package vulnerabilities join the same `REV-###` Security findings and
severity totals; they do not create a second report. Advisory severity is kept
separate from review priority, which accounts for exposure and applicability.
Unknown reachability does not establish safety. A finding must match a resolved
version to an affected advisory range; uncertain matches remain unresolved.

Review recommends changes; it never modifies production code, upgrades packages,
or rewrites lockfiles. Proposed remediation commands are included for later
execution. Apply the findings with [Fix](agents-and-skills.md) or with
Implement's Review Mode:

```text
Implement Critical and High findings from .spec-lite/reviews/review_checkout.md
```

## Automating what happens next

Review emits `review.post` and `review.verdict` as lifecycle events, and
`review.verdict` carries `${verdict}`, `${verdict.code}` (`pass`,
`changes-required`, or `blocked`), and `${summary}`. That is the routing
signal: subscribe to it to notify a channel, hand off to another role, or ask
what to do next with a checkpoint that answers itself when the review passes.
See [Hooks](hooks.md#write-each-type) and
[Gates and checkpoints](hooks-gates-checkpoints.md#automatic-answers-and-loop-limits).

## Related

- [Agents and skills](agents-and-skills.md) — Review, Fix, and Plan Critic in the catalog
- [Hooks](hooks.md) — how `changeset.json` is captured
- [Memory and project state](memory.md) — committing reviews with the code
