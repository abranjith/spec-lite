import Ajv2020 from "ajv/dist/2020.js";
import { resolvePattern } from "../events.js";
import { parseTemplate, validateTemplate } from "../interpolation.js";
import { loadAllSources, normalizePromptName } from "../../utils/prompts.js";
import type { HookDefinition, ResolvedHook } from "../types.js";
import { ControlError, type Choice } from "./types.js";

export const DURATION_PATTERN = "^[1-9][0-9]{0,6}(ms|s|m|h|d)$";
export function duration(
  value: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const match = /^([1-9][0-9]{0,6})(ms|s|m|h|d)$/.exec(value);
  if (!match)
    throw new ControlError(
      "invalid-duration",
      `Invalid finite duration ${value}; use 30s, 5m or 72h (up to seven numeric digits).`,
      2
    );
  const result =
    Number(match[1]) *
    ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]] ?? 0);
  if (!Number.isSafeInteger(result) || result > maximum)
    throw new ControlError(
      "duration-budget",
      `Duration ${value} exceeds the permitted budget (${maximum}ms).`,
      2
    );
  return result;
}
const text = { type: "string", minLength: 1, pattern: "\\S" };
export const CHOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description"],
  properties: {
    description: text,
    skill: text,
    agent: text,
    prompt: text,
    args: { type: "string" },
    continue: { const: true },
    stop: { const: true },
    completion: { const: "reported" },
  },
  oneOf: ["skill", "agent", "prompt", "continue", "stop"].map((key) => ({
    required: [key],
    not: {
      anyOf: ["skill", "agent", "prompt", "continue", "stop"]
        .filter((other) => other !== key)
        .map((other) => ({ required: [other] })),
    },
  })),
  allOf: [
    { if: { required: ["prompt"] }, then: { required: ["completion"] } },
    {
      if: { anyOf: [{ required: ["continue"] }, { required: ["stop"] }] },
      then: {
        not: { anyOf: [{ required: ["args"] }, { required: ["completion"] }] },
      },
    },
  ],
};
export const CHECKPOINT_PROPERTIES: Record<string, Record<string, unknown>> = {
  question: text,
  choices: {
    type: "object",
    minProperties: 2,
    propertyNames: {
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      not: { const: "ask" },
    },
    additionalProperties: CHOICE_SCHEMA,
  },
  attach: { type: "array", items: text, uniqueItems: true },
  inputs: { type: "array", items: text, uniqueItems: true },
  rules: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["if", "choose"],
      properties: {
        if: { type: "object", minProperties: 1, additionalProperties: text },
        choose: text,
      },
    },
  },
  github: {
    type: "object",
    additionalProperties: false,
    properties: {
      target: { enum: ["auto", "issue", "pr"] },
      repo: {
        type: "string",
        pattern: "^(?:[a-zA-Z0-9.-]+/)?[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$",
      },
      approvers: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9-]*$" },
      },
      allowPublic: { type: "boolean" },
      pollSeconds: { type: "integer", minimum: 1, maximum: 3600 },
    },
  },
  expiresIn: { type: "string", pattern: DURATION_PATTERN },
  afterEffects: { type: "boolean" },
};
export const CHECKPOINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question", "choices"],
  properties: CHECKPOINT_PROPERTIES,
};
const validator = new Ajv2020({ allErrors: true, strict: false }).compile(
  CHECKPOINT_SCHEMA
);
export function checkpointErrors(value: unknown): string[] {
  if (!validator(value))
    return (validator.errors ?? []).map(
      (e) => `options${e.instancePath}: ${e.message}`
    );
  const options = value as {
    choices: Record<string, Choice>;
    expiresIn?: string;
    rules?: Array<{ if: Record<string, string>; choose: string }>;
  };
  const errors: string[] = [];
  if (options.expiresIn) {
    try {
      duration(options.expiresIn);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const rule of options.rules ?? [])
    if (!options.choices[rule.choose])
      errors.push(`Rule destination ${rule.choose} is not a declared choice.`);
  return errors;
}
export const checkpoint = (hook: HookDefinition) =>
  hook.type === "builtin" && (hook.builtin ?? hook.name) === "checkpoint";
export const repeatable = (hook: HookDefinition) =>
  hook.type === "builtin" &&
  ["prepare-worktree", "capture-baseline", "capture-changeset"].includes(
    hook.builtin ?? hook.name
  );
export const effectiveOrder = (hook: HookDefinition) =>
  hook.order ?? (hook.gate ? 15 : checkpoint(hook) ? 20 : 100);
export const instrumented = new Set([
  "brainstorm",
  "plan",
  "plan-feature",
  "feature",
  "implement",
  "review",
  "fix",
  "plan-critic",
  "yolo",
]);
export function logicalTarget(choice: Choice): string | undefined {
  const name = choice.skill ?? choice.agent;
  if (!name) return undefined;
  const normalized = normalizePromptName(name.replace(/^spec[.-]/, "")).replace(
    /_/g,
    "-"
  );
  // Provider noun forms map to one logical role.
  const nouns: Record<string, string> = {
    planner: "plan",
    reviewer: "review",
    implementer: "implement",
    fixer: "fix",
    brainstormer: "brainstorm",
    "feature-planner": "plan-feature",
  };
  return nouns[normalized] ?? normalized;
}
export async function validateTargets(
  choices: Record<string, Choice>
): Promise<string[]> {
  const sources = await loadAllSources();
  const known = new Set(sources.map((s) => s.name.replace(/_/g, "-")));
  return Object.entries(choices).flatMap(([key, choice]) => {
    if (choice.prompt && choice.completion !== "reported")
      return [
        `${key}: a prompt hand-off needs "completion": "reported", so the agent records when it is done.`,
      ];
    const logical = logicalTarget(choice);
    if (!logical) return [];
    if (instrumented.has(logical))
      return choice.completion
        ? [
            `${key}: instrumented target ${logical} uses lifecycle completion; remove completion.`,
          ]
        : [];
    if (choice.completion !== "reported")
      return [
        `${key}: ${logical} is not a spec-lite role, so it needs "completion": "reported".`,
      ];
    return known.has(logical) || choice.completion === "reported"
      ? []
      : [`${key}: unavailable target ${logical}.`];
  });
}
export function flowHookErrors(hook: HookDefinition): string[] {
  const errors: string[] = [];
  if (hook.gate) {
    if (!["command", "script"].includes(hook.type))
      errors.push("Only rerunnable command/script hooks support gates.");
    if (hook.onFailure !== "abort")
      errors.push("A gate requires onFailure: abort.");
  }
  if (
    hook.maxRounds !== undefined &&
    (!hook.gate ||
      !Number.isInteger(hook.maxRounds) ||
      hook.maxRounds < 1 ||
      hook.maxRounds > 100)
  )
    errors.push(
      "maxRounds requires a gate and a total round budget from 1 to 100."
    );
  if (checkpoint(hook)) {
    errors.push(...checkpointErrors(hook.options));
    const events = hook.events.flatMap((p) => resolvePattern(p).matched);
    if (
      events.some(
        (e) => e.name.startsWith("checkpoint.") || e.name === "hook.error"
      )
    )
      errors.push(
        "Checkpoints cannot subscribe to checkpoint.* or hook.error."
      );
    const opts = hook.options as
      | {
          question?: string;
          attach?: string[];
          inputs?: string[];
          choices?: Record<string, Choice>;
          rules?: Array<{ if: Record<string, string> }>;
        }
      | undefined;
    for (const template of [
      opts?.question,
      ...(opts?.attach ?? []),
      ...(opts?.inputs ?? []),
    ].filter((s): s is string => typeof s === "string")) {
      errors.push(
        ...validateTemplate(template, events, hook.name, hook.requires).errors
      );
      if (parseTemplate(template).some((r) => r.name.startsWith("decision.")))
        errors.push("Creation templates cannot use decision slots.");
    }
    for (const choice of Object.values(opts?.choices ?? {}))
      for (const template of [
        choice.args,
        choice.prompt,
        choice.description,
      ].filter((s): s is string => typeof s === "string")) {
        const stripped = template.replace(
          /\$\{decision\.(id|question|status|choice|actor|feedbackFile)(?::-[^{}]*)?\}/g,
          "decision-slot"
        );
        errors.push(
          ...validateTemplate(stripped, events, hook.name, hook.requires).errors
        );
      }
    for (const rule of opts?.rules ?? [])
      for (const field of Object.keys(rule.if))
        errors.push(
          ...validateTemplate(
            `\${${field}}`,
            events,
            `${hook.name} rule`,
            hook.requires
          ).errors
        );
  }
  return errors;
}
export function flowOrderErrors(hooks: ResolvedHook[]): string[] {
  const events = new Set(
    hooks.flatMap((hook) =>
      hook.events.flatMap((p) => resolvePattern(p).matched.map((e) => e.name))
    )
  );
  const errors: string[] = [];
  for (const name of events) {
    const subscribed = hooks
      .filter((h) =>
        h.events.some((p) =>
          resolvePattern(p).matched.some((e) => e.name === name)
        )
      )
      .sort((a, b) => effectiveOrder(a) - effectiveOrder(b));
    const routing = subscribed.filter(
      (h) => checkpoint(h) || ["skill", "agent", "prompt"].includes(h.type)
    );
    if (routing.length > 1)
      errors.push(
        `${name}: only one hand-off (skill, agent, prompt) or checkpoint hook may subscribe to an event, but ${routing.map((h) => h.name).join(", ")} do. Combine them into one checkpoint with a choice for each.`
      );
    let effects = false;
    for (const hook of subscribed) {
      if (hook.gate && effects)
        errors.push(
          `${name}: gate ${hook.name} must run before checkpoints and before hooks that change things; lower its order.`
        );
      if (checkpoint(hook) && effects && hook.options?.afterEffects !== true)
        errors.push(
          `${name}: checkpoint ${hook.name} runs after hooks that change things; lower its order, or set options.afterEffects: true.`
        );
      if (!repeatable(hook) && !hook.gate) effects = true;
    }
  }
  return errors;
}
