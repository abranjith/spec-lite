/**
 * Interactive setup of the opt-in builtin hooks, shared by `init`, `update`,
 * and `spec-lite hook setup`. Each hook can be enabled or skipped; an enabled
 * hook is asked for the options it declares (builtins/options.ts). Decisions
 * are written as settings-only entries — `{ name, enabled, options }` — so the
 * hook definitions stay with spec-lite and keep receiving updates.
 */
import fs from "fs-extra";
import inquirer from "inquirer";
import { BUILTIN_HOOKS } from "./builtins/index.js";
import { git } from "./builtins/git-workflow.js";
import {
  BUILTIN_OPTIONS,
  BUILTIN_REQUIRES,
  validateBuiltinOptions,
  type SetupContext,
} from "./builtins/options.js";
import { loadRegistry } from "./registry.js";
import { hooksJsonPath } from "./workspace.js";
import {
  isHookDefinition,
  type HookEntry,
  type HookRegistryFile,
  type HookSettings,
} from "./types.js";

/** The questions setup asks; an interface so tests and other front ends can answer them. */
export interface HookPrompter {
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
  input(
    message: string,
    defaultValue: string | undefined,
    validate: (value: string) => true | string
  ): Promise<string>;
  select(
    message: string,
    choices: string[],
    defaultValue?: string
  ): Promise<string>;
}

export const inquirerPrompter: HookPrompter = {
  async confirm(message, defaultValue) {
    const { value } = await inquirer.prompt<{ value: boolean }>([
      { type: "confirm", name: "value", message, default: defaultValue },
    ]);
    return value;
  },
  async input(message, defaultValue, validate) {
    const { value } = await inquirer.prompt<{ value: string }>([
      {
        type: "input",
        name: "value",
        message,
        default: defaultValue,
        validate,
      },
    ]);
    return value;
  },
  async select(message, choices, defaultValue) {
    const { value } = await inquirer.prompt<{ value: string }>([
      { type: "list", name: "value", message, choices, default: defaultValue },
    ]);
    return value;
  },
};

/** The builtins setup offers: the ones that ship turned off, in registry order. */
export const OPT_IN_HOOKS = BUILTIN_HOOKS.filter(
  (hook) => hook.enabled === false
).map((hook) => hook.name);

async function readProjectRegistry(root: string): Promise<HookRegistryFile> {
  const file = hooksJsonPath(root);
  // A malformed file throws here, so setup never overwrites it.
  return (await fs.pathExists(file))
    ? fs.readJson(file)
    : { version: 1, hooks: [] };
}

/** Opt-in builtins the project's registry has no entry for: never enabled or skipped. */
export async function undecidedHooks(root: string): Promise<string[]> {
  const { hooks } = await readProjectRegistry(root);
  return OPT_IN_HOOKS.filter(
    (name) => !hooks.some((entry) => entry.name === name)
  );
}

/** An executable and its arguments: a JSON array, or space-separated words. */
function parseArgv(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return trimmed.split(/\s+/).filter(Boolean);
  const parsed: unknown = JSON.parse(trimmed);
  if (
    !Array.isArray(parsed) ||
    !parsed.length ||
    !parsed.every((item) => typeof item === "string")
  )
    throw new Error("not a string array");
  return parsed;
}

/** Ask for the options a hook declares; options setup doesn't ask about are kept as they are. */
async function askOptions(
  name: string,
  current: Record<string, unknown>,
  context: SetupContext,
  prompter: HookPrompter
): Promise<Record<string, unknown>> {
  const options = { ...current };
  for (const [key, option] of Object.entries(
    BUILTIN_OPTIONS[name]?.options ?? {}
  )) {
    if (!option.required && !option.label) continue;
    if (option.askIf && !option.askIf(options)) {
      delete options[key]; // e.g. adapter commands left over from another provider
      continue;
    }
    const message = option.label ?? key;
    const schema = option.schema;
    const existing = options[key];
    if (Array.isArray(schema.enum)) {
      options[key] = await prompter.select(
        message,
        schema.enum as string[],
        typeof existing === "string" ? existing : undefined
      );
      continue;
    }
    if (schema.type === "boolean") {
      options[key] = await prompter.confirm(message, existing === true);
      continue;
    }
    // A conditional option is needed whenever its condition holds.
    const required = !!option.required || !!option.askIf;
    const isArgv = schema.type === "array";
    const suggested = isArgv
      ? Array.isArray(existing)
        ? existing.join(" ")
        : undefined
      : typeof existing === "string"
        ? existing
        : option.suggest?.(context);
    const answer = (
      await prompter.input(
        required ? message : `${message} (leave empty for the default)`,
        suggested,
        (value) => {
          const trimmed = value.trim();
          if (!trimmed) return required ? "Required." : true;
          if (option.ref && trimmed.startsWith("-"))
            return "Cannot start with a hyphen.";
          if (isArgv) {
            try {
              parseArgv(trimmed);
            } catch {
              return "Give the executable and its arguments, space-separated or as a JSON array.";
            }
          }
          return true;
        }
      )
    ).trim();
    if (!answer) delete options[key];
    else options[key] = isArgv ? parseArgv(answer) : answer;
  }
  return options;
}

/** Replace every entry named `entry.name` with `entry`, at the first one's position. */
function putEntry(doc: HookRegistryFile, entry: HookEntry): void {
  const index = doc.hooks.findIndex((existing) => existing.name === entry.name);
  doc.hooks = doc.hooks.filter((existing) => existing.name !== entry.name);
  doc.hooks.splice(index === -1 ? doc.hooks.length : index, 0, entry);
}

/** A settings entry carrying the decision, keeping any other settings the user had. */
function decision(
  previous: HookSettings | undefined,
  name: string,
  enabled: boolean,
  options?: Record<string, unknown>
): HookSettings {
  const {
    options: previousOptions,
    enabled: _enabled,
    ...kept
  } = previous ?? { name };
  const nextOptions = options ?? previousOptions;
  return {
    ...kept,
    name,
    enabled,
    ...(nextOptions && Object.keys(nextOptions).length
      ? { options: nextOptions }
      : {}),
  };
}

export interface SetupResult {
  file: string;
  lines: string[];
}

/**
 * Ask about each of `names` (opt-in builtins) and write the decisions to the
 * project registry. A hook whose requirement is not enabled is recorded as
 * skipped without asking. An entry the user defined in full (with `type`) is
 * left alone. If the result would add registry errors, nothing is written.
 */
export async function runHookSetup(
  root: string,
  names: string[],
  prompter: HookPrompter
): Promise<SetupResult> {
  const file = hooksJsonPath(root);
  const doc = await readProjectRegistry(root);
  const before = (await fs.pathExists(file))
    ? await fs.readFile(file, "utf8")
    : undefined;
  const loaded = await loadRegistry(root, { includeDisabled: true });
  const errorsBefore = new Set(
    loaded.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => issue.message)
  );
  const enabled = new Set(
    loaded.hooks
      .filter((hook) => hook.enabled !== false)
      .map((hook) => hook.name)
  );
  // Suggestions build on options already configured, not only this session's answers.
  const chosen = Object.fromEntries(
    loaded.hooks
      .filter((hook) => hook.options)
      .map((hook) => [hook.name, hook.options!])
  );
  const context: SetupContext = {
    currentBranch: await git(root, ["symbolic-ref", "--short", "HEAD"]).catch(
      () => undefined
    ),
    chosen,
  };
  const lines: string[] = [];

  for (const name of OPT_IN_HOOKS.filter((hook) => names.includes(hook))) {
    const previous = doc.hooks.filter((entry) => entry.name === name).at(-1);
    if (previous && isHookDefinition(previous)) {
      lines.push(`Kept ${name}: it has a custom definition in ${file}.`);
      continue;
    }
    const requirement = BUILTIN_REQUIRES[name];
    if (requirement && !enabled.has(requirement.hook)) {
      putEntry(doc, decision(previous, name, false));
      enabled.delete(name);
      lines.push(`Skipped ${name}: it needs ${requirement.hook}.`);
      continue;
    }
    const description =
      BUILTIN_HOOKS.find((hook) => hook.name === name)?.description ?? "";
    if (
      await prompter.confirm(
        `Enable ${name}? ${description}`,
        previous?.enabled === true
      )
    ) {
      const options = await askOptions(
        name,
        previous?.options ?? {},
        context,
        prompter
      );
      const errors = validateBuiltinOptions(name, options).errors;
      if (errors.length) throw new Error(`${name}: ${errors.join("\n")}`);
      context.chosen[name] = options;
      putEntry(doc, decision(previous, name, true, options));
      enabled.add(name);
      lines.push(
        `Enabled ${name}${Object.keys(options).length ? ` ${JSON.stringify(options)}` : ""}`
      );
    } else {
      putEntry(doc, decision(previous, name, false));
      enabled.delete(name);
      lines.push(`Skipped ${name}`);
    }
  }

  await fs.outputJson(file, doc, { spaces: 2 });
  const added = (await loadRegistry(root)).issues
    .filter(
      (issue) => issue.level === "error" && !errorsBefore.has(issue.message)
    )
    .map((issue) => issue.message);
  if (added.length) {
    if (before === undefined) await fs.remove(file);
    else await fs.writeFile(file, before);
    throw new Error(`Hook setup was not saved:\n${added.join("\n")}`);
  }
  return { file, lines };
}

/**
 * The hook step of `init` and `update`: offer the opt-in hooks the project
 * has not decided on. Declining records each as skipped, so later updates ask
 * only about hooks added in newer releases. `spec-lite hook setup` revisits
 * every decision.
 */
export async function offerHookSetup(
  root: string,
  prompter: HookPrompter = inquirerPrompter
): Promise<string[]> {
  const names = await undecidedHooks(root);
  if (!names.length) return [];
  if (
    await prompter.confirm(
      `Set up optional hooks (${names.join(", ")})?`,
      false
    )
  ) {
    return (await runHookSetup(root, names, prompter)).lines;
  }
  const doc = await readProjectRegistry(root);
  for (const name of names) putEntry(doc, { name, enabled: false });
  await fs.outputJson(hooksJsonPath(root), doc, { spaces: 2 });
  return [
    "Skipped optional hooks. Run `spec-lite hook setup` to set them up later.",
  ];
}
