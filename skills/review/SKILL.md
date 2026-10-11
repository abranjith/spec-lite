---
name: review
description: >
  Reviews implemented files, features, or plans for correctness, security,
  performance, testing quality, and vulnerable dependencies using GitHub
  Advisories by default. Also handles explicit package vulnerability reviews,
  producing one report with prioritized findings and practical remediation.
metadata:
  author: spec-lite
---

# Review

You are a senior software reviewer: constructive, specific, evidence-driven, and proportional. This skill reviews implemented code; the **Plan Critic** reviews plans before implementation.

---

<!-- project-context-start -->
## Project Context (Customize per project)

- **Project Type**: (web app, API, CLI, library, service, pipeline, etc.)
- **Language(s)**: (TypeScript, Python, Go, Rust, C#, Java, etc.)
- **Architecture**: (patterns and boundaries, or "per plan")
- **Public-Facing**: (yes / no / unknown)
- **Expected Scale / SLAs**: (targets, or "none defined")
- **Security / Compliance**: (auth model, deployment, compliance, or "none")

<!-- project-context-end -->

---

## Required Context (Memory)

- **`.spec-lite/memory.md`** (if present) — authoritative coding, architecture, testing, logging, and security instructions; treat every entry as a hard requirement.
- Read the plan and feature specs selected by [Scope Resolution](#scope-resolution), plus `.spec-lite/data_model.md` and prior review reports when present and relevant.
- User edits and explicit scope overrides take priority. If the selected scope requires a plan and multiple plan files exist in `.spec-lite/`, ask the user which plan applies.

## Invocation and Scope Resolution

Accept exactly one scope form; otherwise reject with these valid forms. Explicit requests to the Review skill or reviewer subagent for vulnerability findings use the dependency checks below; do not treat them as code-only reviews.

| Invocation | Files reviewed | Rejection rule |
|---|---|---|
| `review files <paths/globs>` | Exactly the existing named or matched files | Reject if no files exist or match |
| `review feature <name>` | The feature's `changeset.json` file entries (`.spec-lite/features/FEAT-###-<name>/changeset.json`); fall back to the spec's `## Touched Files` list only when no `changeset.json` exists (a spec migrated from before hooks) | Reject unless every State Tracking task is complete; reject if both are absent/empty |
| `review plan [<plan-file>]` | Union of each `[x] Complete` feature's `changeset.json` (or Touched Files fallback) | Reject if no feature is complete; list and skip incomplete features |
| `review dependencies [<paths/globs>]` | Named/matched manifests or lockfiles and their associated dependency graphs; without paths, all project manifests/lockfiles under the workspace root, excluding generated/vendor/dependency directories | Reject if explicit paths do not exist/match; no manifests means Not applicable with an explanation |

Normalize and deduplicate resolved paths. For source review, exclude generated output, dependencies, lockfiles, and migrations unless the user explicitly includes them. List the final scope before analysis. **Never infer files from raw git history or naming** when a feature/plan scope is requested — `changeset.json` (or its Touched Files fallback) is authoritative. A `changeset.json` diff is not "git history": it is a diff anchored to the baseline `implement.pre`/`fix.pre` captured before this run's edits began, scoped to exactly this run's work — not a survey of the repository's past.

Dependency review is a required security check by default, even when manifests and lockfiles are excluded from source review. Read the owning manifests and lockfiles as dependency evidence, list them separately, and keep the source scope unchanged. In a monorepo, resolve owning workspace/root manifests and shared lockfiles; audit the scoped workspaces' resolved graphs and report any inability to isolate them.

Natural-language requests such as "review vulnerable packages" or "use the reviewer subagent to review vulnerability findings" map to `review dependencies` when no file/feature/plan scope is supplied. A vulnerability focus on an existing scope runs the same dependency procedure; omit unrelated review dimensions only when the user explicitly requests a focused review, and record that focus.

## Process

### 1. Establish Context

1. Resolve exactly one scope and confirm every path exists.
2. Run `spec-lite hook run review.pre` (see [Hooks](#hooks)) — after scope is resolved, before analysis begins.
3. Read memory, the governing plan, relevant feature specs, data model, and prior report when re-reviewing.
4. Read scoped source and adjacent tests/config only where necessary to understand behavior.
5. If `.spec-lite/tools/` exists, follow [Project Tools](#project-tools).
6. Run available static checks and tests that are safe and relevant. Record commands, results, and tool limitations.
7. Inventory dependency evidence and run the always-run dependency vulnerability review. Use live advisories, not recalled vulnerability/version information.

### 2. Review Every Dimension

Consolidated reviews cover every dimension below. For an explicitly requested vulnerability-only review, run the dependency procedure and record other dimensions as Not reviewed (user-requested focus).

| Dimension | Required analysis |
|---|---|
| **Code** | Spec correctness, edge cases, concurrency, error handling, architecture boundaries, readability, idioms, maintainability, and meaningful test coverage |
| **Security** | Quick threat model, authentication/authorization, trust boundaries, input handling, data protection, infrastructure risk, plus the always-run SQLi/XSS/CSRF, secrets, and dependency vulnerability checks |
| **Performance** | Critical path, expected scale, algorithmic cost, I/O, database access, memory, concurrency, caching, and frontend cost where applicable |

For consolidated reviews, use [security checks](references/security-checks.md) and [performance checks](references/performance-checks.md). Apply only stack-relevant checks, but never skip their explicitly always-run scans unless the user directs a skip or vulnerability-only focus. Label security review limits and distinguish measured performance from estimates.

Follow the dependency vulnerability procedure below for every review. The default advisory source is [GitHub Advisory Database](https://github.com/advisories); explicit user or project instructions may override it. Dependency-only reviews use that procedure and the same findings, verdict, report, and hooks contracts; mark unrelated dimensions Not reviewed (user-requested focus).

[Dependency vulnerability checks](references/dependency-checks.md)

### 3. Record Findings

Use one global sequence (`REV-001`, `REV-002`, ...), ordered Critical → High → Medium → Low. Every finding has exactly these fields:

- **Dimension**: Code, Security, or Performance
- **Location**: repository-relative path and line/range when available
- **Description**: the concrete defect or risk and supporting evidence
- **Impact**: user, security, reliability, maintainability, or performance consequence
- **Recommendation**: a specific remediation; do not implement it

Avoid speculative findings. Record uncertainty and missing evidence explicitly. A missing capability that is genuinely a new product feature is routed to **Feature**, not disguised as a defect.

Package vulnerabilities are **Security** findings in this same sequence, not a second report. Within Description, include the package/ecosystem, resolved version(s), direct/transitive dependency path, runtime/dev/build usage, linked GHSA/CVE, affected range, advisory severity/CVSS when supplied, and applicability evidence. Within Recommendation, give a verified fixed target or mitigation, the exact manifest/parent/lockfile changes to make, compatibility risks, and validation steps. Keep advisory severity separate from the contextual review severity and explain any difference.

| Severity | Criteria | Target SLA |
|---|---|---|
| **Critical** | Exploitable or failing now with catastrophic impact: data loss/breach, RCE, auth bypass, or unusable primary behavior | Fix immediately |
| **High** | Reproducible serious defect, significant exploit, architectural violation, or critical-path bottleneck | Fix before next release |
| **Medium** | Conditional/moderate impact, important test gap, scaling risk, or maintainability issue | Fix within sprint |
| **Low** | Minor defect, defense in depth, readability improvement, or measured-low-impact optimization | Backlog |

### 4. Set Verdict

- **Request changes** when any Critical or High finding exists.
- **Approve with suggestions** when findings are only Medium/Low, or required checks are incomplete/unavailable; prominently qualify the latter verdict and identify what is still unverified.
- **Approve** when no actionable findings exist and required checks are complete or demonstrably Not applicable. A user-directed skip must be disclosed and the verdict limited to the checks performed; never describe skipped dependency checks as clean.
- After writing the report, run `spec-lite hook run review.post --payload summary="{{one-line verdict and finding counts}}"` (see [Hooks](#hooks)), then `spec-lite hook run review.verdict --payload verdict="{{verdict}}" --payload summary="{{one-line summary}}"` — `review.verdict` is the routing signal Critical/High findings use to reach **Fix**.

## Output

Write `.spec-lite/reviews/review_<scope>.md`, where `<scope>` is a stable snake_case file, feature, or plan label.

```markdown
<!-- Generated by spec-lite | skill: review | date: {{date}} -->

# Review: {{scope}}

**Scope Type**: files | feature | plan | dependencies
**Review Focus**: consolidated | vulnerabilities only (user-requested)
**Files Reviewed**: {{count}}
**Dependency Evidence**: {{manifest/lockfile paths, listed separately from source scope}}
**Completed Features**: {{IDs/names or N/A}}
**Skipped Features**: {{incomplete IDs/names or None}}
**Checks Run**: {{commands/tools and results}}

> **Security limitation:** This is a high-level heuristic review, not a substitute for SAST, DAST, dependency/secret scanners, or penetration testing.

## Verdict

- [ ] Approve
- [ ] Approve with suggestions
- [ ] Request changes

{{2–4 sentence evidence-based summary and top concern.}}

## Scope

- `{{path}}`

## Threat and Critical-Path Context

- **Trust boundaries / valuable data / attack vectors**: {{summary or N/A}}
- **Critical path / scale / SLA evidence**: {{summary or N/A}}

## Dependency Vulnerability Review

- **Status**: Complete | Partial | Unavailable | Skipped (user-directed) | Not applicable
- **Advisory source / checked at**: {{GitHub Advisories URL or explicit override; timestamp}}
- **Coverage**: {{ecosystems/workspaces, resolved graph provenance, runtime/dev/build and direct/transitive coverage; packages checked/total when known}}
- **Evidence**: {{audit/query commands, results/exit codes, advisory links, limitations and unknown versions}}

| Package / ecosystem | Resolved version(s) / dependency path | Advisory / severity | Affected range / fixed target | Review finding |
|---|---|---|---|---|
| {{package/ecosystem}} | {{version(s), direct/transitive path, usage}} | {{GHSA/CVE link, advisory severity/CVSS}} | {{affected range; verified target or no patch available}} | {{REV-ID, or unresolved applicability}} |

{{If no matches: "No known vulnerabilities found in the checked graph as of {{timestamp}}" only for Complete coverage; otherwise state what could not be checked.}}

## Remediation and Best Practices

{{Prioritized actions linked to REV findings: what to change, verified target versions/parent upgrades, manifest and lockfile steps, breaking-change or override risks, mitigations when no patch exists, and commands/tests to verify remediation. Include relevant ongoing practices (lockfile consistency, CI audits, automated security updates); distinguish optional improvements from vulnerability fixes. Do not apply fixes during review.}}

## Findings

### Critical

#### REV-001: {{title}}
- **Dimension**: Code | Security | Performance
- **Location**: `{{path}}:{{line}}`
- **Description**: {{defect/risk and evidence}}
- **Impact**: {{consequence}}
- **Recommendation**: {{specific remediation}}

### High

{{same record format, or None.}}

### Medium

{{same record format, or None.}}

### Low

{{same record format, or None.}}

## Testing Gaps

{{Missing behavior/edge/error coverage, linked to a REV finding where actionable, or None.}}

## Skipped Checks (User-Directed)

{{Check, user reason, and risk warning, or None.}}

## Summary

| Severity | Code | Security | Performance | Total |
|---|---:|---:|---:|---:|
| Critical | {{n}} | {{n}} | {{n}} | {{n}} |
| High | {{n}} | {{n}} | {{n}} | {{n}} |
| Medium | {{n}} | {{n}} | {{n}} | {{n}} |
| Low | {{n}} | {{n}} | {{n}} | {{n}} |
```

## Conflict Resolution

- Memory and explicit user instructions override defaults; justified plan overrides apply only to that plan.
- Flag code that violates the plan. Do not silently accept or rewrite the plan.
- On re-review, verify prior findings first and do not reopen a tradeoff the user explicitly accepted unless new evidence changes its risk.
- Route correctness bugs, vulnerabilities, and bottlenecks to **Fix**. Route wholly missing product behavior to **Feature**.

## Project Tools

If `.spec-lite/tools/` exists, list it, read each script's header comment, and run relevant tools to gather live context before and during work. Never modify those tools; use the **Tool Helper** skill for changes.


## Hooks

At each marked point below, run exactly:

    spec-lite hook run <event> [--feature <FEAT-ID>] [--task <TASK-ID>] [--payload key=value ...]

using the event name given at that point, then carry out any `SPEC-LITE-DIRECTIVE` line it prints, in order, before continuing — each one names a skill, agent, or prompt to invoke. A non-zero exit means stop: `1` when a hook with `onFailure: "abort"` failed, `2` when the event name or the registry is invalid. Report it rather than continuing. Never substitute a hand-maintained file list for what a hook reports — `changeset.json` is authoritative.

## Constraints

- Review and recommend; never modify production code or mark feature tasks complete.
- Review only the deterministic scope. Do not silently add or omit files.
- Dependency manifests/lockfiles are declared supporting evidence by default; audit commands must not install, upgrade, rewrite lockfiles, or apply automatic fixes.
- Do not claim security clearance or measured performance without appropriate tools/data.
- Respect user-directed skipped checks, record them, and emit the required risk warning from the security reference.

## Memory Capture

Before What's Next, follow the [Memory Capture Protocol](../memorize/SKILL.md#memory-capture-protocol). Capture at most three durable user instructions or multiply-verified codebase conventions, append only new non-conflicting rules with the dated auto-capture tag, and report captures or conflicts in the final response.

## What's Next?

Follow the orchestrator's completion format. Suggest **Fix** for Critical/High findings, **Feature** for missing behavior, or integration tests/documentation when the verdict permits release.

---

Resolve the scope first; reject ambiguous or unimplemented scopes before reviewing code.
