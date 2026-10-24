/**
 * `${...}` interpolation for hook definitions.
 *
 * This module is the single source of truth for the variable table. The
 * docs/features/hooks.md section, `spec-lite hook vars`, and the enum in
 * schema/hooks.schema.json are all generated from `INTERPOLATION_VARS`, and a
 * test asserts the documented table matches — so documentation cannot drift
 * from the resolver.
 *
 * Three rules keep substitution deterministic:
 *
 *  1. **Single pass, no recursion.** Substitution happens once, left to right.
 *     A substituted value containing `${...}` is never re-expanded. Without
 *     this, a review summary containing the literal text
 *     `${env:AWS_SECRET_ACCESS_KEY}` would exfiltrate a credential into an
 *     outbound webhook.
 *
 *  2. **Fail closed.** An unknown name is rejected by `validateTemplate` at
 *     `spec-lite hook validate` time. A known name with no value for the event
 *     being fired is an error too, unless the template supplies a default with
 *     `${name:-fallback}`. Empty-string substitution is never used: it turns
 *     `git commit -m ${feature.id}: ${summary}` into a malformed command
 *     instead of a loud failure.
 *
 *  3. **Context-aware escaping.** Every substituted value is escaped for where
 *     it lands — shell-quoted in `run`, JSON-escaped in `bodyTemplate`,
 *     percent-encoded in `url`. Values are attacker-influenced (they carry
 *     review findings and feature names), so raw splicing into a shell string
 *     would be a command-injection vector.
 *
 * Grammar:
 *   ${name}                 a table variable
 *   ${name:-default}        …with a fallback when it has no value
 *   ${env:NAME}             a process environment variable
 *   ${env:NAME:-default}    …with a fallback
 *   $${                     a literal "${"
 *
 * A default value may not contain `{` or `}`.
 */

import type { HookPayload } from "./types.js";
import type { EventDefinition, VarGroup } from "./events.js";
import path from "node:path";

/** Where a substituted value will land, which determines how it is escaped. */
export type EscapeContext =
  "shell-posix" | "shell-pwsh" | "json" | "url" | "header" | "none";

/** `base` variables are available on every event; the rest come from event `provides`. */
export interface VarDefinition {
  name: string;
  group: VarGroup | "base";
  description: string;
  example: string;
  resolve: (ctx: ResolveContext) => string | undefined;
}

export interface ResolveContext {
  payload: HookPayload;
  /** Absolute path to the temp file holding the payload JSON, for ${payload.file}. */
  payloadFile?: string;
  /** Environment used for ${env:NAME}. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export class InterpolationError extends Error {
  constructor(
    message: string,
    readonly varName?: string
  ) {
    super(message);
    this.name = "InterpolationError";
  }
}

// ---------------------------------------------------------------------------
// The variable table — the single source of truth
// ---------------------------------------------------------------------------

const V = (
  name: string,
  group: VarGroup | "base",
  description: string,
  example: string,
  resolve: (ctx: ResolveContext) => string | undefined
): VarDefinition => ({ name, group, description, example, resolve });

export const INTERPOLATION_VARS: readonly VarDefinition[] = [
  V(
    "plan.file",
    "plan",
    "Workspace-relative path of the plan the role works on.",
    ".spec-lite/plan_orders.md",
    (c) => (typeof c.payload.plan === "string" ? c.payload.plan : undefined)
  ),
  V(
    "plan.name",
    "plan",
    "Plan name: the plan file name without `plan_` and `.md`.",
    "orders",
    (c) =>
      typeof c.payload.plan === "string"
        ? path.basename(c.payload.plan, ".md").replace(/^plan[_-]?/, "") ||
          "plan"
        : undefined
  ),
  V(
    "report.file",
    "report",
    "Workspace-relative path of the report the role wrote.",
    ".spec-lite/reviews/review_orders.md",
    (c) => (typeof c.payload.report === "string" ? c.payload.report : undefined)
  ),
  V(
    "verdict.code",
    "verdict",
    "Machine-readable verdict: Plan Critic `ready`, `revisions` or `replan`; Review `pass`, `changes-required` or `blocked`.",
    "ready",
    (c) =>
      typeof c.payload.verdictCode === "string"
        ? c.payload.verdictCode
        : undefined
  ),
  V(
    "workflow.id",
    "workflow",
    "ID of the saved workflow (one per feature, plan, fix, change, review or YOLO run). Tracked runs only.",
    "w-1234",
    (c) => (c.payload.workflow as { id?: string })?.id
  ),
  V(
    "execution.id",
    "execution",
    "ID of the role run that fired the event. Tracked runs only.",
    "x-1234",
    (c) => (c.payload.execution as { id?: string })?.id
  ),
  V(
    "action.id",
    "action",
    "ID of the saved action this role run was started from, if any; write `${action.id:-none}`.",
    "a-1234",
    (c) => (c.payload.action as { id?: string })?.id
  ),
  ...(
    [
      [
        "id",
        "decision",
        "Checkpoint ID, as used by `spec-lite decide`.",
        "d-1234",
      ],
      [
        "question",
        "decision",
        "The checkpoint question, with templates resolved.",
        "Plan orders is ready. What next?",
      ],
      [
        "status",
        "decision",
        "`pending`, `answered`, `expired`, `cancelled` or `superseded`.",
        "pending",
      ],
      [
        "url",
        "decision",
        "Link to the GitHub comment, when the checkpoint was posted there; write `${decision.url:-}`.",
        "https://github.com/acme/app/issues/7#issuecomment-1",
      ],
      ["choice", "decision-resolved", "The chosen choice ID.", "critique"],
      [
        "actor",
        "decision-resolved",
        "Who answered: `local-session`, `configured-rule`, or a GitHub login.",
        "local-session",
      ],
      [
        "feedbackFile",
        "decision-resolved",
        "Absolute path of a file holding the answer's free-text feedback.",
        "/repo/.git/spec-lite/decisions/d-1234/feedback.md",
      ],
    ] as const
  ).map(([field, group, description, example]) =>
    V(
      `decision.${field}`,
      group,
      description,
      example,
      (c) => (c.payload.decision as Record<string, string>)?.[field]
    )
  ),
  // --- base: present on every event ---------------------------------------
  V(
    "event",
    "base",
    "Full dotted event name.",
    "implement.post",
    (c) => c.payload.event
  ),
  V(
    "role",
    "base",
    "Agent or skill that emitted the event.",
    "implement",
    (c) => c.payload.role
  ),
  V(
    "phase",
    "base",
    "Lifecycle position: pre, post, or signal.",
    "post",
    (c) => c.payload.phase
  ),
  V(
    "runId",
    "base",
    "Stable id for one `hook run` invocation.",
    "01J9F2K7M4",
    (c) => c.payload.runId
  ),
  V(
    "timestamp",
    "base",
    "ISO-8601 UTC timestamp of the run.",
    "2026-08-21T14:03:11.204Z",
    (c) => c.payload.timestamp
  ),
  V("cwd", "base", "Absolute workspace root.", "/repo", (c) => c.payload.cwd),
  V(
    "provider",
    "base",
    'Configured harness alias, or "unknown".',
    "claude-code",
    (c) => c.payload.provider
  ),
  V(
    "payload",
    "base",
    "The entire payload as compact JSON.",
    '{"event":"implement.post",…}',
    (c) => JSON.stringify(c.payload)
  ),
  V(
    "payload.file",
    "base",
    "Path to a temp file holding the payload JSON.",
    "/tmp/spec-lite-x.json",
    (c) => c.payloadFile
  ),

  // --- feature -------------------------------------------------------------
  V(
    "feature.id",
    "feature",
    "Stable feature identifier.",
    "FEAT-012",
    (c) => c.payload.feature?.id
  ),
  V(
    "feature.name",
    "feature",
    "Snake_case feature name.",
    "user_management",
    (c) => c.payload.feature?.name
  ),
  V(
    "feature.dir",
    "feature",
    "Feature directory, workspace-relative.",
    ".spec-lite/features/FEAT-012-user_management",
    (c) => c.payload.feature?.dir
  ),
  V(
    "feature.spec",
    "feature",
    "Feature spec path, workspace-relative.",
    ".spec-lite/features/FEAT-012-user_management/spec.md",
    (c) => c.payload.feature?.spec
  ),

  // --- change --------------------------------------------------------------
  V(
    "change.name",
    "change",
    "Change name from `--payload change=`, on Implement Change Mode runs.",
    "add-json-flag",
    (c) => (typeof c.payload.change === "string" ? c.payload.change : undefined)
  ),

  // --- task ----------------------------------------------------------------
  V(
    "task.id",
    "task",
    "Task identifier within a feature.",
    "TASK-003",
    (c) => c.payload.task?.id
  ),

  // --- changes -------------------------------------------------------------
  V(
    "changes.count",
    "changes",
    "Number of files in the captured changeset.",
    "12",
    (c) =>
      c.payload.changes ? String(c.payload.changes.files.length) : undefined
  ),
  V(
    "changes.source",
    "changes",
    "How the changeset was captured: git, gh, or none.",
    "git",
    (c) => c.payload.changes?.source
  ),
  V(
    "changes.baseline",
    "changes",
    "Baseline commit the changeset is diffed against.",
    "abc1234",
    (c) => c.payload.changes?.baseline
  ),
  V(
    "changes.head",
    "changes",
    "HEAD of the checkout when the event fired.",
    "def5678",
    (c) => c.payload.changes?.head
  ),
  V(
    "changes.files",
    "changes",
    "Changed paths, newline-separated.",
    "src/a.ts\\nsrc/b.ts",
    (c) =>
      c.payload.changes
        ? c.payload.changes.files.map((f) => f.path).join("\n")
        : undefined
  ),

  // --- verdict / summary ---------------------------------------------------
  V("verdict", "verdict", "Review verdict.", "Request changes", (c) =>
    c.payload.verdict == null ? undefined : String(c.payload.verdict)
  ),
  V(
    "summary",
    "summary",
    "One-line summary supplied by the emitting role.",
    "Added session expiry handling",
    (c) => c.payload.summary
  ),
];

const VARS_BY_NAME = new Map(INTERPOLATION_VARS.map((v) => [v.name, v]));

/** Table rows for generated documentation and `spec-lite hook vars`. */
export function describeVars(): VarDefinition[] {
  return [...INTERPOLATION_VARS];
}

/** Every variable group a hook can name in `requires`, in table order. */
export const VAR_GROUPS: readonly VarGroup[] = [
  ...new Set(
    INTERPOLATION_VARS.map((v) => v.group).filter(
      (g): g is VarGroup => g !== "base"
    )
  ),
];

/**
 * The groups in `requires` that this payload does not carry. A group counts
 * as present only when every variable in it has a value, so a hook that runs
 * can use any of them without a fallback — the same promise `hook validate`
 * makes for it.
 */
export function missingRequirements(
  requires: readonly string[] | undefined,
  ctx: ResolveContext
): string[] {
  return (requires ?? []).filter((group) =>
    INTERPOLATION_VARS.some((v) => {
      if (v.group !== group) return false;
      const value = v.resolve(ctx);
      return value === undefined || value === "";
    })
  );
}

/** Message recorded on a hook skipped for `requires`. */
export const requirementsMessage = (missing: string[]): string =>
  `requires ${missing.join(", ")}, which this run does not carry`;

// ---------------------------------------------------------------------------
// Parsing — one pass, no recursion
// ---------------------------------------------------------------------------

/** A parsed `${...}` reference. */
interface VarRef {
  /** Table name, or the environment variable name when `isEnv`. */
  name: string;
  isEnv: boolean;
  /** Fallback supplied via `:-`, or undefined when the reference is required. */
  fallback?: string;
  /** The original text, for error messages. */
  raw: string;
}

const TOKEN = /\$\$\{|\$\{([^{}]*)\}/g;

function parseRef(inner: string, raw: string): VarRef {
  const isEnv = inner.startsWith("env:");
  const body = isEnv ? inner.slice(4) : inner;
  const sep = body.indexOf(":-");
  if (sep === -1) return { name: body, isEnv, raw };
  return {
    name: body.slice(0, sep),
    isEnv,
    fallback: body.slice(sep + 2),
    raw,
  };
}

/** Every `${...}` reference in a template, in order of appearance. */
export function parseTemplate(template: string): VarRef[] {
  const refs: VarRef[] = [];
  for (const match of template.matchAll(TOKEN)) {
    if (match[0] === "$${") continue;
    refs.push(parseRef(match[1] ?? "", match[0]));
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape a value for its destination.
 *
 * Shell contexts wrap the value in single quotes so it always lands as exactly
 * one argument and every metacharacter inside is inert. This is why a hook
 * cannot splice multiple flags out of one variable — that would require raw
 * substitution, which is a command-injection vector.
 */
export function escapeValue(value: string, context: EscapeContext): string {
  switch (context) {
    case "shell-posix":
      // Close the quote, emit an escaped quote, reopen: 'it'\''s'
      return `'${value.replace(/'/g, `'\\''`)}'`;
    case "shell-pwsh":
      // PowerShell single-quoted strings escape a quote by doubling it
      return `'${value.replace(/'/g, "''")}'`;
    case "json":
      // Template already supplies the surrounding quotes; escape the interior
      return JSON.stringify(value).slice(1, -1);
    case "url":
      return encodeURIComponent(value);
    case "header":
      // An HTTP header value is one line of visible characters. A payload
      // value carrying CR/LF would otherwise inject an extra header (or a
      // body) into the request, so newlines collapse to a space and every
      // other control character is dropped.
      return (
        value
          .replace(/\r\n|[\r\n]/g, " ")
          // eslint-disable-next-line no-control-regex -- Strip control characters to prevent header injection.
          .replace(/[\u0000-\u001f\u007f]/g, "")
      );
    case "none":
      return value;
  }
}

// ---------------------------------------------------------------------------
// Validation — runs at `spec-lite hook validate`, i.e. in CI
// ---------------------------------------------------------------------------

export interface TemplateDiagnostics {
  errors: string[];
  warnings: string[];
  /** Environment variable names the template depends on. */
  envVars: string[];
}

/**
 * Check a template against the variable table and the events a hook subscribes
 * to, without needing a payload.
 *
 * An unknown name is always an error. A known name whose group is not
 * guaranteed by every subscribed event is an error too, unless the reference
 * carries a `:-` fallback or the hook `requires` that group — that is the
 * whole reason events declare `provides`.
 */
export function validateTemplate(
  template: string,
  subscribedEvents: EventDefinition[],
  label: string,
  requires: readonly string[] = []
): TemplateDiagnostics {
  const errors: string[] = [];
  const warnings: string[] = [];
  const envVars: string[] = [];

  for (const ref of parseTemplate(template)) {
    if (ref.isEnv) {
      if (!ref.name) {
        errors.push(
          `${label}: ${ref.raw} is missing an environment variable name.`
        );
        continue;
      }
      envVars.push(ref.name);
      if (ref.fallback === undefined && process.env[ref.name] === undefined) {
        warnings.push(
          `${label}: ${ref.raw} is not set in the current environment. ` +
            `It must be set wherever hooks run, or supply \${env:${ref.name}:-default}.`
        );
      }
      continue;
    }

    const def = VARS_BY_NAME.get(ref.name);
    if (!def) {
      errors.push(
        `${label}: unknown variable \${${ref.name}}. ` +
          `Run \`spec-lite hook vars\` for the supported names.`
      );
      continue;
    }

    if (ref.fallback !== undefined || def.group === "base") continue;
    if (requires.includes(def.group)) continue; // the hook is skipped without it
    if (["workflow.id", "execution.id"].includes(ref.name)) continue; // guaranteed in tracked runs
    if (ref.name === "decision.url") {
      errors.push(`${label}: decision.url is optional; use a fallback.`);
      continue;
    }

    const missing = subscribedEvents.filter(
      (e) => !e.provides.includes(def.group as VarGroup)
    );
    if (missing.length > 0) {
      errors.push(
        `${label}: \${${ref.name}} has no guaranteed value on ` +
          `${missing.map((e) => e.name).join(", ")}. ` +
          `Add "requires": ["${def.group}"] to run the hook only when it is present, ` +
          `subscribe to an event that provides "${def.group}", or write ` +
          `\${${ref.name}:-default}.`
      );
    }
  }

  return { errors, warnings, envVars };
}

// ---------------------------------------------------------------------------
// Resolution — runs at fire time
// ---------------------------------------------------------------------------

export interface ResolveResult {
  value: string;
  /** Environment variable names whose values were substituted, for redaction. */
  usedEnvVars: string[];
}

/**
 * Substitute a template in a single left-to-right pass.
 *
 * Throws `InterpolationError` — which the runner turns into exit code 2 — when
 * a reference has no value and no fallback. Nothing is executed in that case.
 */
export function resolveTemplate(
  template: string,
  ctx: ResolveContext,
  context: EscapeContext
): ResolveResult {
  const env = ctx.env ?? process.env;
  const usedEnvVars: string[] = [];

  const value = template.replace(TOKEN, (raw, inner: string | undefined) => {
    if (raw === "$${") return "${";

    const ref = parseRef(inner ?? "", raw);
    let resolved: string | undefined;

    if (ref.isEnv) {
      resolved = env[ref.name];
      if (resolved !== undefined) usedEnvVars.push(ref.name);
    } else {
      const def = VARS_BY_NAME.get(ref.name);
      if (!def) {
        throw new InterpolationError(
          `Unknown variable \${${ref.name}}. Run \`spec-lite hook vars\` for supported names.`,
          ref.name
        );
      }
      resolved = def.resolve(ctx);
    }

    if (resolved === undefined || resolved === "") {
      if (ref.fallback !== undefined) resolved = ref.fallback;
      else {
        throw new InterpolationError(
          `${ref.raw} has no value on event "${ctx.payload.event}". ` +
            `Write ${ref.raw.replace(/\}$/, ":-default}")} to allow it to be absent.`,
          ref.name
        );
      }
    }

    // Single pass: the substituted value is returned as-is and is never
    // re-scanned for ${...}, so payload text cannot inject further references.
    return escapeValue(resolved, context);
  });

  return { value, usedEnvVars };
}

/** Replace the values of the given env vars with a placeholder, for logs and --dry-run. */
export function redactEnvValues(
  text: string,
  envVars: string[],
  env = process.env
): string {
  let out = text;
  for (const name of envVars) {
    const secret = env[name];
    if (secret && secret.length > 0) {
      out = out.split(secret).join(`\${env:${name}}`);
    }
  }
  return out;
}

/** The escape context for a shell, given the platform default for "auto". */
export function shellEscapeContext(shell: string | undefined): EscapeContext {
  const resolved =
    !shell || shell === "auto"
      ? process.platform === "win32"
        ? "pwsh"
        : "bash"
      : shell;
  return resolved === "pwsh" ? "shell-pwsh" : "shell-posix";
}
