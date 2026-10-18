/**
 * Git publication boundary for automatic commits. Runtime control state lives in the Git common
 * directory, never the worktree, so only spec-lite's own worktree logs and copied runtime records
 * (identified by their generated ID shape) can appear here. Project files — plans, specs, ADRs,
 * `tmp/` fixtures, `events/` sources — stay committable. The npm guard (scripts/check-package.mjs)
 * is deliberately broader because it scans shipped directories only.
 */
const RUNTIME_ID = "[wxeadc]-[0-9a-f]{20}";
const RECORD = new RegExp(
  `(?:^|/)(?:workflows|executions|events|actions|chains|threads)/${RUNTIME_ID}\\.json$`
);
const DECISION = new RegExp(
  `(?:^|/)decisions/d-[0-9a-f]{20}/(?:decision\\.json|feedback\\.md)$`
);
const STORE = new RegExp(
  `(?:^|/)spec-lite/(?:intent\\.json|last-prune|locks/control\\.lock(?:\\.reaping)?|logs/audit\\.jsonl|tmp/tmp-[0-9a-f]{20}\\.[^/]+)$`
);
const WORKTREE_LOG =
  /(?:^|\/)\.spec-lite\/(?:.+\/)?(?:hooks\.log\.jsonl|audit\.jsonl)$/;

export function runtimeArtifactPath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    WORKTREE_LOG.test(normalized) ||
    RECORD.test(normalized) ||
    DECISION.test(normalized) ||
    STORE.test(normalized)
  );
}
