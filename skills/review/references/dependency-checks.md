# Dependency Vulnerability Checks

Run this check by default during every Review, and when the user explicitly asks the Review skill or reviewer subagent for vulnerability findings. Review and recommend; do not install dependencies, update manifests/lockfiles, or run automatic fixes.

## Inventory and Coverage

1. Find the scoped code's owning manifests, workspace/root manifests, and corresponding lockfiles or other resolved graph evidence. For `review dependencies` without paths, discover all project manifests/lockfiles under the workspace root. Exclude generated output, caches, vendor directories, installed dependency trees, and `.git`; list and deduplicate the selected evidence before analysis.
2. Identify package managers from project configuration and lockfiles; honor the project's configured manager. Cover direct and transitive dependencies, every resolved version, and runtime, development, build, and test usage. Development dependencies can expose CI or build systems; do not dismiss them solely because they are absent from production.
3. Prefer exact versions from lockfiles or an existing resolved graph. A manifest range is not an installed version. If versions or transitive paths cannot be resolved without installation, record that gap and any potentially affected declaration as unresolved applicability; do not invent a resolution or claim full coverage. Missing/stale lockfiles and shared graphs that cannot be isolated must be disclosed.
4. List ecosystems/workspaces reviewed, graph provenance, package counts when available, and omitted areas. No applicable package manifests means **Not applicable**, with a reason. An unsupported ecosystem, absent tool, offline lookup, rate limit, or failed/partial query means **Partial** or **Unavailable**, not "no vulnerabilities."

## Live Advisory Lookup

Use [GitHub Advisory Database](https://github.com/advisories) as the default authority. An explicit user/project source override takes precedence; name the actual source and why it differs. Ecosystem audits are evidence collectors, not an implicit replacement for the chosen advisory source.

- Use available read-only ecosystem audit tools to enumerate candidate advisories and dependency paths. Record the command, working directory, tool version when available, exit code, and result. A nonzero audit exit can indicate findings; inspect the output before treating it as a tool failure.
- Inspect configured omissions, severity filters, exclusions, and ignored advisories; disclose them and ensure the lookup covers any gaps before calling coverage Complete.
- Query GitHub directly for packages/versions when a scanner is unavailable or does not cover the resolved graph. Use ecosystem-aware lookups and handle all result pages. Never infer the absence of advisories from a general web search or a single results page.
- The public [global advisories REST API](https://docs.github.com/en/rest/security-advisories/global-advisories) supports `GET https://api.github.com/advisories` with `ecosystem`, URL-encoded `affects` entries (`package@version`), `type=reviewed`, `is_withdrawn=false`, and `per_page=100`; follow pagination links. Public lookups can be unauthenticated. Separate ecosystems, and batch requests within URL and documented API limits. The default API results exclude malware; check `type=malware` separately and state whether this coverage was obtained.
- Retrieve each candidate's advisory detail and verify exact package/ecosystem, affected range, withdrawn status, patched versions, and exploitation prerequisites. Treat unreviewed advisories as provisional unless corroborated; exclude withdrawn advisories from active findings, recording relevant dismissals. Cite each specific GHSA page and CVE when present, together with the lookup timestamp.
- Audit the full selected graph rather than only known suspects. Deduplicate scanner/advisory results by vulnerability identity and package, keeping all affected resolved versions and paths. Distinct packages affected by one advisory must retain their own remediation evidence. Do not submit secrets or private source; external queries need only package identifiers and versions.

Read-only audit examples, when the matching manager/tool is already available:

| Ecosystem / evidence | Candidate collection | Coverage caveat |
|---|---|---|
| npm / `package-lock.json` | `npm audit --json --include=dev --include=optional --include=peer` | Include the full graph despite configured omissions; do not use `npm audit fix` or `--force` |
| pnpm / `pnpm-lock.yaml` | `pnpm audit --json` | Use the owning workspace; include dev dependencies |
| Yarn / `yarn.lock` | Modern Yarn: `yarn npm audit --all --recursive --json`; Yarn Classic: `yarn audit --json` | Detect the installed major version; options differ |
| Python / resolved requirements or lockfile | `pip-audit --no-deps --disable-pip -r <fully-pinned-requirements>` when supported | Requires a complete pinned inventory; do not run a mode that resolves or installs packages |
| Rust / `Cargo.lock` | `cargo audit --json` | RustSec results need verification against the selected source |
| Go / `go.mod`, `go.sum`, existing graph | `govulncheck -json ./...` when it can run without fetching dependencies | May require graph/build resolution; distinguish affected versions from reachable vulnerable symbols |
| Other ecosystems or unavailable tools | Query GitHub using package/ecosystem and exact resolved versions | Checksums, manifest ranges, or an incomplete graph alone cannot establish full coverage |

These examples are conditional, not required installations. Verify installed tool help/options before running, and avoid execution modes that download project dependencies or trigger lifecycle/build scripts. Use direct advisory queries if a tool cannot operate without those side effects. Preserve raw audit evidence only when useful and sanitized.

Tool guidance: [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/), [Yarn audit](https://yarnpkg.com/cli/npm/audit), and [pip-audit](https://github.com/pypa/pip-audit).

## Confirm and Prioritize Findings

- Confirm a vulnerability only when a resolved version falls in a non-withdrawn advisory's affected range for the exact package/ecosystem. Use ecosystem version semantics, not lexical comparison. If version or range matching is uncertain, report an unresolved match and the evidence needed to decide.
- Include manifest/lockfile location (line when available), package/ecosystem, affected versions, direct/transitive dependency path, runtime/dev/build use, advisory links/IDs, affected ranges, and available patched branches.
- Preserve the advisory's severity and CVSS score/vector when supplied. Assign the report's Critical/High/Medium/Low priority from exposure, exploit prerequisites, reachability, and impact under Review's severity criteria. Explain differences; unknown reachability is not proof of safety, and an affected package alone does not prove exploitability.
- Summarize known exploitation or vulnerable symbol use only with evidence. Separate confirmed matches, unresolved applicability, accepted risk, and withdrawn/unaffected candidates so the finding count is reproducible.

## Recommend What to Change and How

For each confirmed finding, write a concrete Recommendation in the consolidated report:

1. **Target:** verify a released, non-vulnerable target compatible with the project's supported runtime and dependency constraints. Prefer the smallest supported upgrade that addresses all applicable advisories for that package; a first-patched version from one advisory may still be affected by another. Cite advisory and upstream release/migration guidance; never guess a fixed version or recommend "latest" without verification.
2. **Direct dependency:** identify the owning manifest entry, target constraint/version, and the project's package-manager command to regenerate its lockfile. Present commands as proposed remediation, not actions to execute during review.
3. **Transitive dependency:** identify the introducing direct parent(s) and a verified parent release that resolves to a safe dependency. If proposing an override/resolution as a temporary measure, describe compatibility/support risks, the owner and removal condition, and the checks needed to establish the resulting graph.
4. **No patch or blocked upgrade:** say so explicitly. Suggest removing/replacing an unused or unmaintained package, disabling the affected feature, restricting untrusted input/access, or applying an upstream-supported mitigation as appropriate. Describe residual risk and what evidence would justify any time-limited acceptance; never label a mitigation a patched version.
5. **Validation:** specify the dependency tree/lockfile entries to verify, rerun the same audit/advisory checks, and run focused behavior tests plus build/runtime compatibility checks affected by the update. For breaking upgrades, identify migration work and regression areas; avoid blanket force-fix commands.

Add a prioritized remediation plan linked to `REV-###` findings. Include project-relevant ongoing practices: commit consistent lockfiles, use reproducible installs, add dependency scanning to CI with an explicit severity policy, enable automated security-update proposals, and document time-limited exceptions with an owner/recheck date. Keep optional best-practice suggestions distinct from confirmed vulnerabilities.

## Report Coverage Honestly

Use the main Review report's Dependency Vulnerability Review and Remediation and Best Practices sections; merge confirmed vulnerabilities into the global Security finding sequence and summary without double counting. Record the source, checked-at timestamp, manifests/lockfiles, tool/query evidence, runtime/dev/build and direct/transitive coverage, limitations, and skipped checks.

Only **Complete** coverage permits "No known vulnerabilities found in the checked graph as of <timestamp>"; this does not establish security clearance. For **Partial**, **Unavailable**, or **Skipped**, state what remains unverified and how to complete it. Apply Review's qualified verdict rules; a failed lookup must not produce an unqualified approval. On re-review, verify the new resolved graph against live advisories and mark prior findings resolved only with evidence.
