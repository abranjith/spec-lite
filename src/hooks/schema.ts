/**
 * JSON Schema for `.spec-lite/hooks.json`, generated into `schema/hooks.schema.json`
 * by `npm run generate:hooks-schema` for editor autocomplete. This object is the
 * source of truth — a test asserts the on-disk file matches it, so the two
 * cannot drift.
 */
import { allEventNames } from "./events.js";
import { BUILTIN_OPTIONS, optionsSchema } from "./builtins/options.js";
import { SETTINGS_FIELDS } from "./types.js";

/**
 * A builtin's `options` are typed by its handler: the `builtin` field, or the
 * hook's `name` when that field is omitted. That covers both a complete
 * builtin entry and a settings-only entry (no `type`) for a builtin.
 */
function builtinOptionsRules(): Record<string, unknown>[] {
  return Object.entries(BUILTIN_OPTIONS).map(([id, spec]) => ({
    if: {
      allOf: [
        {
          anyOf: [
            { not: { required: ["type"] } },
            { required: ["type"], properties: { type: { const: "builtin" } } },
          ],
        },
        {
          anyOf: [
            { required: ["builtin"], properties: { builtin: { const: id } } },
            {
              not: { required: ["builtin"] },
              required: ["name"],
              properties: { name: { const: id } },
            },
          ],
        },
      ],
    },
    then: { properties: { options: optionsSchema(spec) } },
  }));
}

export function buildHooksSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://raw.githubusercontent.com/abranjith/spec-lite/main/schema/hooks.schema.json",
    title: "spec-lite hooks.json",
    type: "object",
    required: ["version", "hooks"],
    additionalProperties: false,
    properties: {
      version: { const: 1 },
      hooks: {
        type: "array",
        items: { $ref: "#/$defs/hook" },
      },
    },
    $defs: {
      hook: {
        type: "object",
        // Without `type`, an entry configures a hook an earlier layer defines.
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          events: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description:
              'Concrete event names or wildcard patterns (e.g. "implement.*"). ' +
              `Known concrete events: ${allEventNames().join(", ")}.`,
          },
          type: {
            enum: [
              "command",
              "script",
              "http",
              "builtin",
              "skill",
              "agent",
              "prompt",
            ],
          },
          description: { type: "string" },
          enabled: { type: "boolean", default: true },
          order: { type: "number", default: 100 },
          timeoutMs: { type: "number", default: 30000 },
          onFailure: { enum: ["warn", "abort", "ignore"], default: "warn" },
          once: { type: "boolean", default: false },
          gate: { type: "boolean", default: false },
          maxRounds: { type: "integer", minimum: 1, maximum: 100, default: 3 },
          completion: { const: "reported" },
          payloadSchema: { type: "object" },

          builtin: { type: "string" },
          options: {
            type: "object",
            description:
              "Settings of a builtin that declares them; see the builtin options table in docs/features/hooks.md.",
          },

          run: { type: "string" },
          shell: { enum: ["auto", "bash", "pwsh"], default: "auto" },
          cwd: { type: "string" },
          env: { type: "object", additionalProperties: { type: "string" } },

          url: { type: "string" },
          method: { type: "string", default: "POST" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          bodyTemplate: { type: "string" },

          skill: { type: "string" },
          agent: { type: "string" },
          prompt: { type: "string" },
          args: { type: "string" },
        },
        additionalProperties: false,
        allOf: [
          {
            if: { required: ["gate"], properties: { gate: { const: true } } },
            then: {
              required: ["onFailure"],
              properties: {
                type: { enum: ["command", "script"] },
                onFailure: { const: "abort" },
              },
            },
          },
          { if: { required: ["type"] }, then: { required: ["events"] } },
          {
            if: { not: { required: ["type"] } },
            then: { propertyNames: { enum: [...SETTINGS_FIELDS] } },
          },
          {
            if: {
              properties: { type: { const: "command" } },
              required: ["type"],
            },
            then: { required: ["run"] },
          },
          {
            if: {
              properties: { type: { const: "script" } },
              required: ["type"],
            },
            then: { required: ["run"] },
          },
          {
            if: { properties: { type: { const: "http" } }, required: ["type"] },
            then: { required: ["url"] },
          },
          {
            if: {
              properties: { type: { const: "skill" } },
              required: ["type"],
            },
            then: { required: ["skill"] },
          },
          {
            if: {
              properties: { type: { const: "agent" } },
              required: ["type"],
            },
            then: { required: ["agent"] },
          },
          {
            if: {
              properties: { type: { const: "prompt" } },
              required: ["type"],
            },
            then: { required: ["prompt"] },
          },
          ...builtinOptionsRules(),
        ],
      },
    },
  };
}
