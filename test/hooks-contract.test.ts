import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runEvent } from "../src/hooks/runner.js";
import { clearPayloadSchemaCache } from "../src/hooks/payload-validation.js";

const execFileAsync = promisify(execFile);
let root: string;

/** Builtins are disabled in most fixtures so assertions target only the hook under test. */
const DISABLE_BUILTINS = [
  { name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false },
  { name: "capture-changeset", events: ["implement.post"], type: "builtin", enabled: false },
];

async function writeHooks(hooks: unknown[]): Promise<void> {
  const file = path.join(root, ".spec-lite", "hooks.json");
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { version: 1, hooks: [...DISABLE_BUILTINS, ...hooks] }, { spaces: 2 });
}

beforeEach(async () => {
  clearPayloadSchemaCache();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-contract-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "t@t.local"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
  await fs.writeFile(path.join(root, "a.txt"), "x\n");
  await execFileAsync("git", ["add", "a.txt"], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: root });
});

afterEach(async () => {
  await fs.remove(root);
});

describe("payloadSchema is validated before invocation", () => {
  it("fails closed with exit 2 when the payload does not satisfy the schema", async () => {
    const marker = path.join(root, "side-effect.txt");
    await writeHooks([
      {
        name: "needs-task",
        events: ["implement.post"],
        type: "command",
        // If this ever runs, the marker file proves the side effect happened.
        run: `node -e "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'ran')"`,
        payloadSchema: { type: "object", required: ["task"] },
      },
    ]);

    const report = await runEvent({ root, event: "implement.post" });

    expect(report.exitCode).toBe(2);
    const result = report.results.find((r) => r.name === "needs-task");
    expect(result?.status).toBe("failed");
    expect(result?.contractError).toBe(true);
    expect(result?.message).toContain("payloadSchema");
    // The whole point: no half-executed side effect.
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it("passes when the payload satisfies the schema", async () => {
    await writeHooks([
      {
        name: "needs-task",
        events: ["implement.task.post"],
        type: "command",
        run: "echo ok",
        payloadSchema: { type: "object", required: ["task"] },
      },
    ]);

    const report = await runEvent({ root, event: "implement.task.post", taskId: "TASK-001" });
    expect(report.exitCode).toBe(0);
    expect(report.results.find((r) => r.name === "needs-task")?.status).toBe("ok");
  });

  it("reports an invalid schema as a contract error rather than crashing", async () => {
    await writeHooks([
      {
        name: "bad-schema",
        events: ["implement.post"],
        type: "command",
        run: "echo hi",
        payloadSchema: { type: "not-a-real-type" },
      },
    ]);

    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(2);
    expect(report.results[0]?.message).toContain("invalid payloadSchema");
  });
});

describe("contract errors bypass onFailure", () => {
  it("an unresolvable ${...} exits 2 even under onFailure: warn", async () => {
    await writeHooks([
      {
        name: "bad-template",
        events: ["implement.post"],
        type: "command",
        // task.id is not guaranteed on implement.post and has no fallback.
        run: "echo ${task.id}",
        onFailure: "warn",
      },
    ]);

    // Registry validation catches this first — which is the desired outcome:
    // it is caught in CI by `hook validate`, before ever firing.
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(2);
  });

  it("a ${...} that only fails at runtime still exits 2, not 0", async () => {
    await writeHooks([
      {
        name: "runtime-missing",
        events: ["implement.post"],
        type: "command",
        // feature.id IS guaranteed by implement.post's `provides`, so this
        // passes validate-time checking; it only fails when fired without
        // --feature. That is the runtime fail-closed path.
        run: "echo ${feature.id}",
        onFailure: "warn",
      },
    ]);

    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(2);
    expect(report.results[0]?.contractError).toBe(true);
  });
});

describe("registry errors stop the run", () => {
  it("exits 2 and dispatches nothing when a hook names an unknown event", async () => {
    await writeHooks([
      { name: "good", events: ["implement.post"], type: "command", run: "echo ok" },
      { name: "bogus", events: ["not.a.real.event"], type: "command", run: "echo no" },
    ]);

    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(2);
    expect(report.results).toEqual([]);
    expect(report.registryIssues.some((i) => i.includes("not.a.real.event"))).toBe(true);
  });
});

describe("hook.error", () => {
  it("fires when another hook fails, carrying a summary of the failure", async () => {
    const errorLog = path.join(root, "error-log.txt");
    await writeHooks([
      { name: "boom", events: ["implement.post"], type: "command", run: "exit 1", onFailure: "warn" },
      {
        name: "on-error",
        events: ["hook.error"],
        type: "command",
        run: `node -e "require('fs').writeFileSync(${JSON.stringify(errorLog).replace(/"/g, "'")}, process.env.SPEC_LITE_EVENT + '|' + ${"process.argv"}.length)"`,
      },
    ]);

    const report = await runEvent({ root, event: "implement.post" });

    expect(report.results.find((r) => r.name === "boom")?.status).toBe("failed");
    expect(await fs.pathExists(errorLog)).toBe(true);
    expect(await fs.readFile(errorLog, "utf-8")).toContain("hook.error");
  });

  it("does not fire when nothing failed", async () => {
    const errorLog = path.join(root, "error-log-2.txt");
    await writeHooks([
      { name: "fine", events: ["implement.post"], type: "command", run: "echo ok" },
      {
        name: "on-error",
        events: ["hook.error"],
        type: "command",
        run: `node -e "require('fs').writeFileSync(${JSON.stringify(errorLog).replace(/"/g, "'")}, 'x')"`,
      },
    ]);

    await runEvent({ root, event: "implement.post" });
    expect(await fs.pathExists(errorLog)).toBe(false);
  });

  it("does not recurse when a hook.error handler itself fails", async () => {
    await writeHooks([
      { name: "boom", events: ["implement.post"], type: "command", run: "exit 1", onFailure: "warn" },
      { name: "also-boom", events: ["hook.error"], type: "command", run: "exit 1", onFailure: "warn" },
    ]);

    // Completes rather than looping; the guard is that emitHookError is never
    // entered for the hook.error event itself.
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(0);
  }, 15000);
});

describe("repository-wide kill switch", () => {
  it("dispatches nothing when .spec-lite.json sets hooks.enabled false", async () => {
    const marker = path.join(root, "should-not-exist.txt");
    await writeHooks([
      {
        name: "noisy",
        events: ["implement.post"],
        type: "command",
        run: `node -e "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'ran')"`,
      },
    ]);
    await fs.writeJson(path.join(root, ".spec-lite.json"), {
      version: "0.3.0",
      provider: "claude-code",
      installedPrompts: [],
      installedAt: "",
      updatedAt: "",
      documentation: { directory: "docs", level: "technical", updateWithDevelopment: false },
      hooks: { enabled: false },
    });

    const report = await runEvent({ root, event: "implement.post" });
    expect(report.disabled).toBe(true);
    expect(report.results).toEqual([]);
    expect(report.exitCode).toBe(0);
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it("runs normally when the switch is absent", async () => {
    await writeHooks([{ name: "fine", events: ["implement.post"], type: "command", run: "echo ok" }]);
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.disabled).toBeUndefined();
    expect(report.results.find((r) => r.name === "fine")?.status).toBe("ok");
  });
});

describe("an event outside the catalog is a contract error", () => {
  it("exits 2 and dispatches nothing", async () => {
    const marker = path.join(root, "should-not-run.txt");
    await writeHooks([
      {
        name: "wildcard",
        events: ["*"],
        type: "command",
        run: `node -e "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'ran')"`,
      },
    ]);

    const report = await runEvent({ root, event: "implement.postt" });

    expect(report.exitCode).toBe(2);
    expect(report.results[0]?.contractError).toBe(true);
    expect(report.results[0]?.message).toContain("unknown event");
    // A typo must not quietly skip the hooks the correct name would have run.
    expect(await fs.pathExists(marker)).toBe(false);
  });

  it("still yields to the repository kill switch", async () => {
    await fs.writeJson(path.join(root, ".spec-lite.json"), { hooks: { enabled: false } });
    const report = await runEvent({ root, event: "not.an.event" });
    expect(report.disabled).toBe(true);
    expect(report.exitCode).toBe(0);
  });
});

describe("${provider} resolves from .spec-lite.json", () => {
  it("carries the configured harness alias", async () => {
    const out = path.join(root, "provider.txt");
    await fs.writeJson(path.join(root, ".spec-lite.json"), {
      version: "0.3.0",
      provider: "codex",
      providers: ["codex", "claude-code"],
    });
    await writeHooks([
      {
        name: "show-provider",
        events: ["implement.post"],
        type: "command",
        run: `node -e "require('fs').writeFileSync(${JSON.stringify(out).replace(/"/g, "'")}, process.argv[1])" \${provider}`,
      },
    ]);

    const report = await runEvent({ root, event: "implement.post" });

    expect(report.exitCode).toBe(0);
    expect(report.payload.provider).toBe("codex");
    expect((await fs.readFile(out, "utf-8")).trim()).toBe("codex");
  });

  it("falls back to \"unknown\" instead of failing closed when no config exists", async () => {
    await writeHooks([
      { name: "show-provider", events: ["implement.post"], type: "command", run: "echo ${provider}" },
    ]);

    const report = await runEvent({ root, event: "implement.post" });

    expect(report.payload.provider).toBe("unknown");
    expect(report.results.find((r) => r.name === "show-provider")?.status).toBe("ok");
    expect(report.exitCode).toBe(0);
  });
});
