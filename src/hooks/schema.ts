/**
 * JSON Schema for `.spec-lite/hooks.json`, generated into `schema/hooks.schema.json`
 * by `npm run generate:hooks-schema` for editor autocomplete. This object is the
 * source of truth — a test asserts the on-disk file matches it, so the two
 * cannot drift.
 */
import { allEventNames } from "./events.js";

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
        required: ["name", "events", "type"],
        properties: {
          name: { type: "string", minLength: 1 },
          events: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description:
              "Concrete event names or wildcard patterns (e.g. \"implement.*\"). " +
              `Known concrete events: ${allEventNames().join(", ")}.`,
          },
          type: { enum: ["command", "script", "http", "builtin", "skill", "agent", "prompt"] },
          description: { type: "string" },
          enabled: { type: "boolean", default: true },
          order: { type: "number", default: 100 },
          timeoutMs: { type: "number", default: 30000 },
          onFailure: { enum: ["warn", "abort", "ignore"], default: "warn" },
          once: { type: "boolean", default: false },
          payloadSchema: { type: "object" },

          builtin: { type: "string" },

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
            if: { properties: { type: { const: "command" } }, required: ["type"] },
            then: { required: ["run"] },
          },
          {
            if: { properties: { type: { const: "script" } }, required: ["type"] },
            then: { required: ["run"] },
          },
          {
            if: { properties: { type: { const: "http" } }, required: ["type"] },
            then: { required: ["url"] },
          },
          {
            if: { properties: { type: { const: "skill" } }, required: ["type"] },
            then: { required: ["skill"] },
          },
          {
            if: { properties: { type: { const: "agent" } }, required: ["type"] },
            then: { required: ["agent"] },
          },
          {
            if: { properties: { type: { const: "prompt" } }, required: ["type"] },
            then: { required: ["prompt"] },
          },
        ],
      },
    },
  };
}
