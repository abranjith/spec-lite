/**
 * Type surface for the spec-lite hook system.
 *
 * Hooks fall into two classes that must not be blurred:
 *
 *  - **Deterministic** (`command`, `script`, `http`) — executed by this CLI,
 *    in-process, with exit codes, timeouts, and a failure policy.
 *  - **Agentic** (`skill`, `agent`, `prompt`) — NOT executed here. They are
 *    emitted to stdout as `SPEC-LITE-DIRECTIVE` lines for the calling harness
 *    to carry out, and are therefore best-effort.
 */

/** Lifecycle position of an event relative to the role that emits it. */
export type HookPhase = "pre" | "post" | "signal";

/** Executor kind. See the class split in the module docblock. */
export type HookKind = "command" | "script" | "http" | "builtin" | "skill" | "agent" | "prompt";

/**
 * Deterministic kinds are run by the CLI; agentic kinds are emitted as directives.
 * `builtin` is a distinct deterministic kind: shipped changeset-capture logic
 * runs in-process (native TypeScript, `src/hooks/builtins/`) rather than as a
 * subprocess. This keeps it cross-platform (no shipped .sh) and avoids
 * depending on `spec-lite` resolving on PATH from within its own process.
 */
export const DETERMINISTIC_KINDS: readonly HookKind[] = ["command", "script", "http", "builtin"];
export const AGENTIC_KINDS: readonly HookKind[] = ["skill", "agent", "prompt"];

export function isAgenticKind(kind: HookKind): boolean {
  return AGENTIC_KINDS.includes(kind);
}

/**
 * What happens when a hook fails.
 * - `warn`   (default) log and continue; the run still exits 0
 * - `abort`  stop the chain; `hook run` exits 1 so the skill halts
 * - `ignore` swallow silently (not even a warning)
 */
export type HookFailurePolicy = "warn" | "abort" | "ignore";

/**
 * Shell used for `command`/`script` hooks. `auto` = sh on posix, powershell on win32.
 * cmd.exe is deliberately unsupported: its quoting rules cannot be applied
 * correctly, and safe interpolation depends on correct quoting.
 */
export type HookShell = "auto" | "bash" | "pwsh";

/** Where a resolved hook came from, for provenance in `spec-lite hook list`. */
export type HookSource = "builtin" | "global" | "project";

/**
 * One hook entry as written in `.spec-lite/hooks.json`.
 *
 * `name` is the merge key: a project hook with the same name as a builtin
 * replaces it wholesale (replace, not deep-merge — predictable, and mirrors
 * the "replace, don't append" rule already used by feature-summary.md).
 */
export interface HookDefinition {
  /** Unique merge key. Overriding a builtin means reusing its exact name. */
  name: string;
  /** Event names or wildcard patterns this hook subscribes to. */
  events: string[];
  /** Executor kind. */
  type: HookKind;
  /** Human-readable note; surfaced by `hook list`. */
  description?: string;
  /** Default true. Set false to disable a builtin without redefining it. */
  enabled?: boolean;
  /** Lower runs first; ties broken by declaration order. Default 100. */
  order?: number;
  /** Wall-clock budget for deterministic kinds. Default 30000. */
  timeoutMs?: number;
  /** Default "warn". */
  onFailure?: HookFailurePolicy;
  /** When true, skip if this hook already ran for the current runId. */
  once?: boolean;
  /** Optional JSON Schema validated against the payload BEFORE invocation. */
  payloadSchema?: Record<string, unknown>;

  // --- builtin ---
  /** Handler id in the builtin registry. Defaults to `name` when omitted. */
  builtin?: string;

  // --- command | script ---
  /** Command line (`command`) or script path (`script`). Supports ${...} interpolation. */
  run?: string;
  /** Shell selection for `command`/`script`. Default "auto". */
  shell?: HookShell;
  /** Working directory, relative to the workspace root. Default: workspace root. */
  cwd?: string;
  /** Extra environment variables. Values support ${...} interpolation. */
  env?: Record<string, string>;

  // --- http ---
  /** Target URL. Supports ${env:NAME} so secrets stay out of the committed file. */
  url?: string;
  /** Default "POST". */
  method?: string;
  /** Default { "Content-Type": "application/json" }. */
  headers?: Record<string, string>;
  /** Request body. Supports ${...} interpolation. Defaults to the full payload JSON. */
  bodyTemplate?: string;

  // --- skill | agent | prompt (agentic: emitted, never executed here) ---
  /** Skill name for `type: "skill"`. */
  skill?: string;
  /** Agent name for `type: "agent"`. */
  agent?: string;
  /** Literal instruction for `type: "prompt"`. */
  prompt?: string;
  /** Arguments passed along with a skill/agent directive. Supports ${...}. */
  args?: string;
}

/** A hook after registry merge, carrying its provenance. */
export interface ResolvedHook extends HookDefinition {
  source: HookSource;
}

/** Shape of `.spec-lite/hooks.json` and `~/.spec-lite/hooks.json`. */
export interface HookRegistryFile {
  /** Registry format version. Currently 1. */
  version: number;
  hooks: HookDefinition[];
}

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

/** A single file in a captured changeset. Status follows git's --name-status codes. */
export interface ChangedFile {
  path: string;
  /** A=added, M=modified, D=deleted, R=renamed, U=untracked-new */
  status: "A" | "M" | "D" | "R" | "U";
  /** Which role recorded this path (implement, fix, …). */
  role?: string;
  /** TASK-### this path was first attributed to, when known. */
  task?: string;
}

/** Changeset section of the payload. `source: "none"` means no VCS was available. */
export interface ChangesPayload {
  source: "git" | "gh" | "none";
  baseline?: string;
  head?: string;
  files: ChangedFile[];
}

/** The JSON handed to every hook — on stdin, as env vars, and for ${...} interpolation. */
export interface HookPayload {
  hooksVersion: number;
  event: string;
  role: string;
  phase: HookPhase;
  /** Stable id for one `hook run` invocation; used by `once` and the audit log. */
  runId: string;
  timestamp: string;
  cwd: string;
  /** Configured harness alias, when known. */
  provider?: string;
  feature?: {
    id?: string;
    name?: string;
    dir?: string;
    spec?: string;
  };
  task?: { id?: string };
  changes?: ChangesPayload;
  /** Free-text summary supplied by the caller via --payload summary=… */
  summary?: string;
  /** Review verdict, present on review.verdict. */
  verdict?: string | null;
  /** Any additional --payload key=value pairs. */
  [key: string]: unknown;
}

/** Outcome of one hook execution. */
export interface HookResult {
  name: string;
  event: string;
  kind: HookKind;
  status: "ok" | "failed" | "skipped" | "emitted";
  exitCode?: number;
  durationMs: number;
  message?: string;
  /** For agentic kinds: the directive line emitted to stdout. */
  directive?: string;
  /** For --dry-run: the fully resolved command/url/body/directive, with any ${env:...} values redacted. */
  preview?: string;
  /**
   * True when the hook could not be invoked at all — an unresolvable ${...}
   * reference, or a payload that fails the hook's payloadSchema. Contract
   * errors bypass `onFailure` and force exit code 2: letting
   * `onFailure: "warn"` swallow a misconfigured registry would reintroduce
   * exactly the silent non-determinism this system removes.
   */
  contractError?: boolean;
}
