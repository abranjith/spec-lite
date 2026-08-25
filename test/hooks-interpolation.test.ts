import { describe, it, expect } from "vitest";
import {
  INTERPOLATION_VARS,
  resolveTemplate,
  validateTemplate,
  escapeValue,
  redactEnvValues,
  InterpolationError,
  type ResolveContext,
} from "../src/hooks/interpolation.js";
import { getEvent, type EventDefinition } from "../src/hooks/events.js";
import type { HookPayload } from "../src/hooks/types.js";

function payload(over: Partial<HookPayload> = {}): HookPayload {
  return {
    hooksVersion: 1,
    event: "implement.post",
    role: "implement",
    phase: "post",
    runId: "RUN1",
    timestamp: "2026-08-21T00:00:00.000Z",
    cwd: "/repo",
    provider: "claude-code",
    feature: {
      id: "FEAT-012",
      name: "user_management",
      dir: ".spec-lite/features/FEAT-012-user_management",
      spec: ".spec-lite/features/FEAT-012-user_management/spec.md",
    },
    changes: { source: "git", baseline: "abc1234", head: "def5678", files: [] },
    summary: "Added session expiry handling",
    ...over,
  };
}

const ctx = (over: Partial<HookPayload> = {}): ResolveContext => ({ payload: payload(over) });
const ev = (name: string): EventDefinition => {
  const e = getEvent(name);
  if (!e) throw new Error(`no such event: ${name}`);
  return e;
};

describe("rule 1 — single pass, no recursion", () => {
  it("does not re-expand ${...} that arrives inside a substituted value", () => {
    // The exfiltration case: attacker-influenced text containing a var reference.
    const hostile = "release ${env:AWS_SECRET_ACCESS_KEY} now";
    const { value } = resolveTemplate("${summary}", ctx({ summary: hostile }), "none");

    expect(value).toBe(hostile);
    expect(value).toContain("${env:AWS_SECRET_ACCESS_KEY}");
  });

  it("treats $${ as a literal ${ without resolving it", () => {
    const { value } = resolveTemplate("$${summary} is literal", ctx(), "none");
    expect(value).toBe("${summary} is literal");
  });
});

describe("rule 2 — fail closed", () => {
  it("throws when a table variable has no value on this event", () => {
    expect(() => resolveTemplate("${task.id}", ctx(), "none")).toThrow(InterpolationError);
  });

  it("uses the :- fallback instead of throwing", () => {
    const { value } = resolveTemplate("${task.id:-none}", ctx(), "none");
    expect(value).toBe("none");
  });

  it("throws on an unknown variable name rather than substituting empty", () => {
    expect(() => resolveTemplate("${feature.nope}", ctx(), "none")).toThrow(/Unknown variable/);
  });

  it("never yields the malformed-command case that empty substitution would", () => {
    // git commit -m ": " is exactly the silent non-determinism being removed.
    expect(() =>
      resolveTemplate("git commit -m ${feature.id}: ${task.id}", ctx(), "shell-posix")
    ).toThrow(InterpolationError);
  });
});

/**
 * Parse a POSIX single-quoted token back to its literal value.
 * Throws if any character sits outside a quoted span — which is exactly the
 * safety property escapeValue("shell-posix") must guarantee.
 */
function posixUnquote(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      i++;
      while (i < s.length && s[i] !== "'") out += s[i++];
      if (i >= s.length) throw new Error("unterminated quote");
      i++;
    } else if (s[i] === "\\" && s[i + 1] === "'") {
      out += "'";
      i += 2;
    } else {
      throw new Error(`unquoted character ${JSON.stringify(s[i])} at index ${i}`);
    }
  }
  return out;
}

describe("rule 3 — context-aware escaping", () => {
  const hostile = `fix: a"; rm -rf ~ #`;

  it("neutralises shell metacharacters as a single POSIX argument", () => {
    const { value } = resolveTemplate("git commit -m ${summary}", ctx({ summary: hostile }), "shell-posix");
    expect(value).toBe(`git commit -m 'fix: a"; rm -rf ~ #'`);

    // Every character of the substituted token is inside quotes, and it
    // round-trips to the original — so the shell sees one inert argument.
    const token = value.slice("git commit -m ".length);
    expect(posixUnquote(token)).toBe(hostile);
  });

  it("leaves no character unquoted for any metacharacter", () => {
    for (const nasty of [`a'b`, `$(whoami)`, "`id`", "a\nb", "a|b&c;d", "*", "~", "\\", "'"]) {
      const escaped = escapeValue(nasty, "shell-posix");
      expect(posixUnquote(escaped), `round-trip failed for ${JSON.stringify(nasty)}`).toBe(nasty);
    }
  });

  it("escapes an embedded single quote by closing and reopening", () => {
    const { value } = resolveTemplate("${summary}", ctx({ summary: "it's here" }), "shell-posix");
    expect(value).toBe(`'it'\\''s here'`);
    expect(posixUnquote(value)).toBe("it's here");
  });

  it("doubles single quotes for PowerShell", () => {
    expect(escapeValue("it's", "shell-pwsh")).toBe("'it''s'");
  });

  it("keeps a JSON body parseable when the value contains quotes", () => {
    const { value } = resolveTemplate(
      '{"text":"${summary}"}',
      ctx({ summary: 'he said "hi"\nnewline' }),
      "json"
    );
    expect(() => JSON.parse(value)).not.toThrow();
    expect(JSON.parse(value).text).toBe('he said "hi"\nnewline');
  });

  it("percent-encodes for URLs", () => {
    const { value } = resolveTemplate(
      "https://x.test/?f=${feature.name}&s=${summary}",
      ctx({ summary: "a b&c=d" }),
      "url"
    );
    expect(value).toBe("https://x.test/?f=user_management&s=a%20b%26c%3Dd");
  });
});

describe("validate-time checking against event `provides`", () => {
  it("rejects ${task.id} for a hook subscribed only to implement.post", () => {
    const d = validateTemplate("${task.id}", [ev("implement.post")], "run");
    expect(d.errors).toHaveLength(1);
    expect(d.errors[0]).toContain("implement.post");
    expect(d.errors[0]).toContain("task");
  });

  it("accepts ${task.id} on implement.task.post, which guarantees it", () => {
    expect(validateTemplate("${task.id}", [ev("implement.task.post")], "run").errors).toEqual([]);
  });

  it("accepts a fallback even when the group is not guaranteed", () => {
    expect(validateTemplate("${task.id:-none}", [ev("implement.post")], "run").errors).toEqual([]);
  });

  it("flags the weakest event when a hook subscribes to several", () => {
    const d = validateTemplate(
      "${feature.id}",
      [ev("implement.post"), ev("fix.post")],
      "run"
    );
    // fix.post does not guarantee a feature; implement.post does.
    expect(d.errors[0]).toContain("fix.post");
    expect(d.errors[0]).not.toContain("implement.post,");
  });

  it("allows base variables on every event", () => {
    expect(validateTemplate("${event} ${runId} ${cwd}", [ev("fix.pre")], "run").errors).toEqual([]);
  });

  it("warns, but does not error, on an unset env var", () => {
    const d = validateTemplate("${env:DEFINITELY_UNSET_XYZ}", [ev("fix.post")], "url");
    expect(d.errors).toEqual([]);
    expect(d.warnings).toHaveLength(1);
    expect(d.envVars).toEqual(["DEFINITELY_UNSET_XYZ"]);
  });
});

describe("secret redaction", () => {
  it("replaces a substituted env value with its reference in log output", () => {
    const env = { SLACK_WEBHOOK_URL: "https://hooks.slack.test/T/B/xoxb-secret" };
    const { value, usedEnvVars } = resolveTemplate("${env:SLACK_WEBHOOK_URL}", { payload: payload(), env }, "none");

    expect(value).toContain("xoxb-secret");
    expect(redactEnvValues(value, usedEnvVars, env)).toBe("${env:SLACK_WEBHOOK_URL}");
  });
});

describe("the variable table is well-formed", () => {
  it("has unique names", () => {
    const names = INTERPOLATION_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("resolves every base variable from a minimal payload", () => {
    for (const v of INTERPOLATION_VARS.filter((v) => v.group === "base")) {
      const resolved = v.resolve({ payload: payload(), payloadFile: "/tmp/p.json" });
      expect(resolved, `base var \${${v.name}} must always resolve`).toBeDefined();
    }
  });
});
