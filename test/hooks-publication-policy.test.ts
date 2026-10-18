import { describe, expect, it } from "vitest";
import { runtimeArtifactPath } from "../src/hooks/publication.js";
// The release guard is intentionally standalone so it runs before any package is published.
import {
  assertPackageContents,
  assertPackOutput,
} from "../scripts/check-package.mjs";

const id = (prefix: string) => `${prefix}-${"0123456789abcdef0123"}`;

describe("npm runtime artifact publication policy", () => {
  const runtime = [
    "dist/decisions/d-123/decision.json",
    "agents/plan/feedback.md",
    "skills/fix/tmp/tmp-123.response.json",
    "references/debug.log",
    "schema/hooks.log.jsonl",
    ".spec-lite/features/FEAT-001-test/hooks.log.jsonl",
    "dist/actions/a-123.json",
    "dist/executions/x-123.json",
    "dist/spec-lite/logs/audit.jsonl",
  ];
  it.each(runtime)("rejects %s inside included directories", (file) => {
    expect(() => assertPackageContents([{ path: file }])).toThrow(
      "Runtime artifacts"
    );
  });
});

describe("npm pack JSON compatibility", () => {
  const first = {
    name: "@abranjith/spec-lite",
    files: [{ path: "dist/index.js" }, { path: "README.md" }],
  };
  const second = { name: "other", files: [{ path: "LICENSE" }] };
  const formats = [
    { label: "legacy array", wrap: (items: (typeof first)[]) => items },
    {
      label: "package-name map",
      wrap: (items: (typeof first)[]) =>
        Object.fromEntries(items.map((item) => [item.name, item])),
    },
  ];

  for (const { label, wrap } of formats) {
    it(`counts every file in a ${label}`, () => {
      expect(assertPackOutput(wrap([first]))).toBe(2);
      expect(assertPackOutput(wrap([first, second]))).toBe(3);
    });

    it(`checks later packages in a ${label} for runtime artifacts`, () => {
      const invalid = { name: "other", files: [{ path: "dist/debug.log" }] };
      expect(() => assertPackOutput(wrap([first, invalid]))).toThrow(
        "Runtime artifacts"
      );
    });

    it(`rejects missing file lists in a ${label}`, () => {
      expect(() =>
        assertPackOutput(wrap([{ name: "broken" } as typeof first]))
      ).toThrow("Invalid npm pack output");
    });
  }

  it.each(
    [
      null,
      true,
      42,
      "unexpected",
      [],
      {},
      { error: { code: "EPACK" } },
      [null],
      [{ files: "invalid" }],
    ].map((output) => ({ output }))
  )("rejects invalid or empty output: $output", ({ output }) => {
    expect(() => assertPackOutput(output)).toThrow("Invalid npm pack output");
  });
});

describe("Git runtime artifact policy for automatic commits", () => {
  const runtime = [
    ".spec-lite/features/FEAT-001-test/hooks.log.jsonl",
    `spec-lite/decisions/${id("d")}/decision.json`,
    `spec-lite/decisions/${id("d")}/feedback.md`,
    `copied/workflows/${id("w")}.json`,
    `copied/executions/${id("x")}.json`,
    `copied/events/${id("e")}.json`,
    `copied/actions/${id("a")}.json`,
    `copied/chains/${id("c")}.json`,
    "spec-lite/intent.json",
    "spec-lite/locks/control.lock",
    `spec-lite/tmp/${id("tmp")}.payload.json`,
  ];
  it.each(runtime)("rejects %s", (file) =>
    expect(runtimeArtifactPath(file)).toBe(true)
  );

  // Ordinary consumer files must stay committable (review REV-003).
  const ordinary = [
    "docs/decisions/0001-use-postgres.md",
    "docs/adr/decisions/0002.md",
    "src/events/order-created.json",
    "config/locks/policy.json",
    "test/fixtures/tmp/.gitkeep",
    "packages/app/tmp/seed.sql",
    "intent.json",
    "src/nlu/intent.json",
    "docs/feedback.md",
    "app/threads/README.md",
    "src/chains/ethereum.json",
    ".github/workflows/w-deploy.json",
    "debug.log",
    "logs/audit.jsonl",
    ".spec-lite/plan.md",
    ".spec-lite/features/FEAT-001-test/spec.md",
    ".spec-lite/features/FEAT-001-test/changeset.json",
    ".spec-lite/reviews/review_orders.md",
  ];
  it.each(ordinary)("allows %s", (file) =>
    expect(runtimeArtifactPath(file)).toBe(false)
  );

  it("keeps shipped files packageable", () => {
    const allowed = [
      "dist/index.js",
      "agents/plan/AGENT.md",
      "skills/fix/SKILL.md",
      "schema/hooks.schema.json",
    ];
    expect(allowed.some(runtimeArtifactPath)).toBe(false);
    expect(assertPackageContents(allowed)).toBe(allowed.length);
  });
});
