/**
 * Validates the event payload against a hook's optional `payloadSchema`
 * BEFORE the hook is invoked, so a contract mismatch fails with a clear
 * message rather than a half-executed side effect.
 *
 * This is a *contract* error, not a runtime failure: it means the hook could
 * not be invoked at all. It therefore bypasses `onFailure` and stops the chain
 * with exit code 2, the same way an unresolvable `${...}` reference does.
 * Treating it as an ordinary failure would let `onFailure: "warn"` silently
 * swallow a misconfigured registry — exactly the quiet non-determinism this
 * system exists to remove.
 */
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { HookDefinition, HookPayload } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

/** Compiled schemas are cached per hook name so a chain does not recompile. */
const cache = new Map<string, ValidateFunction | null>();

function compile(hook: HookDefinition): ValidateFunction | null {
  if (cache.has(hook.name)) return cache.get(hook.name) ?? null;

  let compiled: ValidateFunction | null = null;
  if (hook.payloadSchema) {
    try {
      compiled = ajv.compile(hook.payloadSchema);
    } catch (err) {
      // An invalid schema is itself a contract error; surface it at call time
      // with the hook named, rather than throwing during registry load.
      compiled = (() => false) as unknown as ValidateFunction;
      (compiled as unknown as { schemaError?: string }).schemaError =
        err instanceof Error ? err.message : String(err);
    }
  }

  cache.set(hook.name, compiled);
  return compiled;
}

export interface PayloadValidationResult {
  ok: boolean;
  message?: string;
}

export function validatePayloadForHook(
  hook: HookDefinition,
  payload: HookPayload
): PayloadValidationResult {
  const validate = compile(hook);
  if (!validate) return { ok: true }; // no payloadSchema declared

  const schemaError = (validate as unknown as { schemaError?: string }).schemaError;
  if (schemaError) {
    return { ok: false, message: `invalid payloadSchema: ${schemaError}` };
  }

  // Read the event name before validating: ajv's ValidateFunction is a type
  // guard, so `payload` is narrowed to `never` in the failure branch.
  const eventName = payload.event;
  const valid = validate(payload) as boolean;
  if (valid) return { ok: true };

  const detail = (validate.errors ?? [])
    .map((e) => `payload${e.instancePath || ""} ${e.message}`)
    .join("; ");
  return {
    ok: false,
    message: `payload does not satisfy payloadSchema on event "${eventName}": ${detail}`,
  };
}

/** Exposed for tests that need a clean slate between compiled-schema fixtures. */
export function clearPayloadSchemaCache(): void {
  cache.clear();
}
