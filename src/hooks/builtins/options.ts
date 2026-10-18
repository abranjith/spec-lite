/**
 * The settings builtin hooks accept in their registry entry's `options`
 * object, and which builtins depend on others. Each builtin declares its own
 * here, and everything else derives from this table: the hooks JSON schema
 * (editor autocomplete per builtin), `hook validate`, the interactive hook
 * setup in `init`/`update`/`hook setup`, and the options table in
 * docs/features/hooks.md. A new builtin with settings needs only an entry
 * below.
 *
 * Pure: no Git or filesystem access.
 */
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CHECKPOINT_PROPERTIES,
  checkpointErrors,
} from "../control/validation.js";

type JsonSchema = Record<string, unknown>;

/** What hook setup knows while asking: the repository and the answers so far. */
export interface SetupContext {
  currentBranch?: string;
  /** Options chosen so far, by hook name. */
  chosen: Record<string, Record<string, unknown>>;
}

export interface OptionSpec {
  schema: JsonSchema;
  /** One line for the docs table, including the default. */
  description: string;
  required?: boolean;
  /** A branch or remote name, passed to Git and provider CLIs as one argument. */
  ref?: boolean;
  /** The setup question. Setup asks required options, and optional ones that have a label. */
  label?: string;
  /** Ask only when this holds for the hook's answers so far. */
  askIf?: (answers: Record<string, unknown>) => boolean;
  /** The default offered by setup. */
  suggest?: (context: SetupContext) => string | undefined;
}

export interface BuiltinOptionsSpec {
  options: Record<string, OptionSpec>;
  /** Rules that span options, beyond each option's own schema. */
  validate?: (options: Record<string, unknown>) => OptionsReport;
}

export interface OptionsReport {
  errors: string[];
  warnings: string[];
}

/** Variables a `commit-progress` `commitMessage` template may reference. */
export const COMMIT_VARS = ["id", "task", "summary", "branch"] as const;
export const COMMIT_TEMPLATE_RE = /\$\{(\w+)(?::-([^}]*))?\}/g;

const text: JsonSchema = { type: "string", minLength: 1, pattern: "\\S" };
// The program name must be non-blank; later arguments may legitimately be empty strings.
const argv: JsonSchema = {
  type: "array",
  minItems: 1,
  items: { type: "string" },
  prefixItems: [{ type: "string", pattern: "\\S" }],
};

export const BUILTIN_OPTIONS: Record<string, BuiltinOptionsSpec> = {
  checkpoint: {
    options: Object.fromEntries(
      Object.entries(CHECKPOINT_PROPERTIES).map(([name, schema]) => [
        name,
        {
          schema,
          required: ["question", "choices"].includes(name),
          description: `Durable checkpoint ${name}; see the Hook Protocol.`,
        },
      ])
    ),
    validate: (options) => ({
      errors: checkpointErrors(options),
      warnings:
        options.github &&
        !(options.github as { approvers?: string[] }).approvers?.length
          ? [
              "options.github.approvers is unset, so the authenticated gh account is the only approver. The coding agent can post with that same account; name a different account for independent approval.",
            ]
          : [],
    }),
  },
  "prepare-worktree": {
    options: {
      fromBranch: {
        schema: text,
        ref: true,
        description:
          "Branch new worktrees start from: local (`develop`) or remote-tracking (`origin/develop`). Default: the main checkout's current branch; `validate` warns when unset.",
        label:
          "Branch new worktrees start from (e.g. develop or origin/develop)",
        suggest: (context) => context.currentBranch,
      },
      fetch: {
        schema: { type: "boolean" },
        description:
          "Fetch `fromBranch` from `remote` first and start from the remote's latest commit. Default: `false`.",
      },
      remote: {
        schema: text,
        ref: true,
        description: "Remote `fetch` reads from. Default: `origin`.",
      },
      worktreeRoot: {
        schema: text,
        description:
          "Folder for worktrees, relative to the main checkout. Default: `.worktrees`.",
      },
    },
    validate: (options) => {
      const errors: string[] = [];
      if (options.fetch === true && options.fromBranch === undefined)
        errors.push(
          "options.fetch needs options.fromBranch: the branch to fetch."
        );
      if (typeof options.worktreeRoot === "string") {
        const normalized = path.normalize(options.worktreeRoot.trim());
        if (normalized === "." || normalized.split(/[\\/]/)[0] === ".git")
          errors.push(
            "options.worktreeRoot must name a folder other than the checkout itself or .git."
          );
      }
      const warnings =
        options.fromBranch === undefined
          ? [
              "options.fromBranch is not set, so each worktree starts from whatever branch the main checkout has checked out.",
            ]
          : [];
      return { errors, warnings };
    },
  },
  "commit-progress": {
    options: {
      remote: {
        schema: text,
        ref: true,
        description:
          "Remote to push to. Recorded for `create-pull-request` and cleanup. Default: `origin`.",
      },
      commitMessage: {
        schema: text,
        description:
          "Commit subject template using `${id}` (feature ID, or the branch), `${task}`, `${summary}`, and `${branch}`; `${task:-final}` sets a default. Default: `FEAT-020 TASK-003: <summary>`.",
      },
    },
    validate: (options) => {
      const errors: string[] = [];
      if (typeof options.commitMessage === "string") {
        for (const [, name] of options.commitMessage.matchAll(
          COMMIT_TEMPLATE_RE
        )) {
          if (!(COMMIT_VARS as readonly string[]).includes(name)) {
            errors.push(
              `options.commitMessage uses \${${name}}; available: ${COMMIT_VARS.map((v) => `\${${v}}`).join(", ")}.`
            );
          }
        }
      }
      return { errors, warnings: [] };
    },
  },
  "create-pull-request": {
    options: {
      provider: {
        schema: { enum: ["github", "azure-devops", "command"] },
        required: true,
        description:
          "Where pull requests are opened; `command` runs your own adapter.",
        label: "Where are pull requests opened?",
      },
      targetBranch: {
        schema: text,
        ref: true,
        required: true,
        description: "Branch pull requests merge into. Never inferred.",
        label: "Branch pull requests merge into",
        // A remote-tracking start branch (origin/develop) targets develop.
        suggest: (context) =>
          (
            context.chosen["prepare-worktree"]?.fromBranch as string | undefined
          )?.replace(/^origin\//, "") ?? context.currentBranch,
      },
      command: {
        schema: argv,
        description:
          "`command` provider: executable and arguments that create a PR.",
        label: "Command that creates a PR (executable and arguments)",
        askIf: (answers) => answers.provider === "command",
      },
      lookupCommand: {
        schema: argv,
        description:
          "`command` provider: executable and arguments that find existing PRs.",
        label: "Command that finds existing PRs (executable and arguments)",
        askIf: (answers) => answers.provider === "command",
      },
    },
    validate: (options) => {
      const errors: string[] = [];
      if (options.provider === "command") {
        if (options.command === undefined)
          errors.push(
            "The command provider needs options.command (executable and arguments)."
          );
        if (options.lookupCommand === undefined)
          errors.push(
            "The command provider needs options.lookupCommand, which prevents duplicate PRs."
          );
      }
      return { errors, warnings: [] };
    },
  },
};

/**
 * Builtins that only work alongside another. `hook validate` rejects one
 * enabled without its requirement, and hook setup only offers it once the
 * requirement is enabled.
 */
export const BUILTIN_REQUIRES: Record<string, { hook: string; why: string }> = {
  "commit-progress": {
    hook: "prepare-worktree",
    why: "creates the worktree it commits in",
  },
  "create-pull-request": {
    hook: "commit-progress",
    why: "pushes the branch the pull request is opened from",
  },
};

/** JSON Schema for one builtin's `options` object. */
export function optionsSchema(spec: BuiltinOptionsSpec): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.entries(spec.options)
      .filter(([, option]) => option.required)
      .map(([name]) => name),
    properties: Object.fromEntries(
      Object.entries(spec.options).map(([name, option]) => [
        name,
        { ...option.schema, description: option.description },
      ])
    ),
  };
}

const optionAjv = new Ajv2020({ strict: false });
const matchesSchema = (value: unknown, schema: JsonSchema): boolean =>
  optionAjv.validate(schema, value) as boolean;

/**
 * Check a builtin's options. The registry schema already rejects wrong types
 * and unknown keys in files; checking again here covers definitions that
 * never went through a file and gives each rule its own message.
 */
export function validateBuiltinOptions(
  handler: string,
  raw: unknown
): OptionsReport {
  const spec = BUILTIN_OPTIONS[handler];
  if (!spec)
    return {
      errors: raw === undefined ? [] : ["This builtin takes no options."],
      warnings: [],
    };
  if (
    raw !== undefined &&
    (typeof raw !== "object" || raw === null || Array.isArray(raw))
  )
    return { errors: ["options must be an object."], warnings: [] };
  const options = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(options))
    if (!spec.options[key])
      errors.push(`options.${key} is not a ${handler} option.`);
  for (const [name, option] of Object.entries(spec.options)) {
    const value = options[name];
    if (value === undefined) {
      if (option.required)
        errors.push(`options.${name} is required: ${option.description}`);
      continue;
    }
    if (!matchesSchema(value, option.schema))
      errors.push(`options.${name} is invalid: ${option.description}`);
    else if (option.ref && (value as string).startsWith("-"))
      errors.push(`options.${name} cannot start with a hyphen.`);
  }
  const extra = spec.validate?.(options) ?? { errors: [], warnings: [] };
  return { errors: [...errors, ...extra.errors], warnings: extra.warnings };
}
