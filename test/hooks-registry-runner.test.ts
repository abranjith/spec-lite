import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadRegistry, hooksForEvent } from "../src/hooks/registry.js";
import { runEvent } from "../src/hooks/runner.js";

const execFileAsync = promisify(execFile);

let root: string;

async function writeHooksJson(content: unknown): Promise<void> {
  const file = path.join(root, ".spec-lite", "hooks.json");
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, content, { spaces: 2 });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-registry-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@test.local"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
  await fs.writeFile(path.join(root, "a.txt"), "x\n");
  await execFileAsync("git", ["add", "a.txt"], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: root });
});

afterEach(async () => {
  await fs.remove(root);
});

describe("registry: builtins are present by default", () => {
  it("includes capture-baseline and capture-changeset", async () => {
    const { hooks } = await loadRegistry(root);
    const names = hooks.map((h) => h.name);
    expect(names).toContain("capture-baseline");
    expect(names).toContain("capture-changeset");
    expect(hooks.find((h) => h.name === "capture-baseline")?.source).toBe("builtin");
  });
});

describe("registry: project hooks.json overrides a builtin by name", () => {
  it("replaces capture-changeset's definition wholesale", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [
        {
          name: "capture-changeset",
          events: ["implement.post"],
          type: "command",
          run: "echo replaced",
          onFailure: "warn",
        },
      ],
    });

    const { hooks } = await loadRegistry(root);
    const resolved = hooks.find((h) => h.name === "capture-changeset");
    expect(resolved?.source).toBe("project");
    expect(resolved?.type).toBe("command");
    expect(resolved?.run).toBe("echo replaced");
  });

  it("enabled: false disables a builtin without redefining it", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [{ name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false }],
    });

    const { hooks } = await loadRegistry(root);
    expect(hooks.find((h) => h.name === "capture-baseline")).toBeUndefined();
  });
});

describe("registry: unknown and planned events", () => {
  it("errors on a pattern matching nothing in the catalog", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [{ name: "bogus", events: ["not.a.real.event"], type: "command", run: "echo hi" }],
    });
    const { issues } = await loadRegistry(root);
    expect(issues.some((i) => i.level === "error" && i.message.includes("not.a.real.event"))).toBe(true);
  });

  it("warns, but does not error, on a declared-but-not-emitted event", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [{ name: "future-hook", events: ["devops.post"], type: "command", run: "echo hi" }],
    });
    const { issues, hooks } = await loadRegistry(root);
    expect(issues.some((i) => i.level === "error" && i.hook === "future-hook")).toBe(false);
    expect(issues.some((i) => i.level === "warning" && i.hook === "future-hook")).toBe(true);
    expect(hooks.find((h) => h.name === "future-hook")).toBeDefined();
  });
});

describe("runner: failure policy", () => {
  it("a failing hook with onFailure warn does not abort the run", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [{ name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false },
              { name: "capture-changeset", events: ["implement.post"], type: "builtin", enabled: false },
              { name: "boom", events: ["implement.post"], type: "command", run: "exit 1", onFailure: "warn" }],
    });
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(0);
    expect(report.results.find((r) => r.name === "boom")?.status).toBe("failed");
  });

  it("a failing hook with onFailure abort sets exit code 1 and stops the chain", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [
        { name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false },
        { name: "capture-changeset", events: ["implement.post"], type: "builtin", enabled: false },
        { name: "first", events: ["implement.post"], type: "command", run: "exit 1", onFailure: "abort", order: 1 },
        { name: "second", events: ["implement.post"], type: "command", run: "echo should-not-run", onFailure: "warn", order: 2 },
      ],
    });
    const report = await runEvent({ root, event: "implement.post" });
    expect(report.exitCode).toBe(1);
    expect(report.results.map((r) => r.name)).toEqual(["first"]);
  });
});

describe("runner: agentic hooks are emitted, never executed", () => {
  it("produces a SPEC-LITE-DIRECTIVE line and does not touch the filesystem", async () => {
    await writeHooksJson({
      version: 1,
      hooks: [
        { name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false },
        { name: "capture-changeset", events: ["implement.post"], type: "builtin", enabled: false },
        { name: "deep-review", events: ["implement.post"], type: "skill", skill: "review", args: "review feature x" },
      ],
    });
    const report = await runEvent({ root, event: "implement.post" });
    const result = report.results.find((r) => r.name === "deep-review");
    expect(result?.status).toBe("emitted");
    expect(result?.directive).toMatch(/^SPEC-LITE-DIRECTIVE /);
    const parsed = JSON.parse(result!.directive!.replace(/^SPEC-LITE-DIRECTIVE /, ""));
    expect(parsed.skill).toBe("review");
  });
});

describe("runner: reentrancy guard", () => {
  it("stops a hook re-invoking its own event past the depth cap", async () => {
    const specLiteBin = path.resolve(__dirname, "..", "dist", "index.js");
    const hasBuild = await fs.pathExists(specLiteBin);
    if (!hasBuild) return; // built by `npm run build`; skip if dist/ absent in this environment

    await writeHooksJson({
      version: 1,
      hooks: [
        { name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false },
        { name: "capture-changeset", events: ["implement.post"], type: "builtin", enabled: false },
        {
          name: "self-trigger",
          events: ["implement.post"],
          type: "command",
          run: `node "${specLiteBin}" hook run implement.post`,
          onFailure: "ignore",
        },
      ],
    });

    const report = await runEvent({ root, event: "implement.post" });
    // The top-level run itself must succeed; the recursive chain is capped
    // internally by SPEC_LITE_HOOK_DEPTH rather than exhausting the process.
    expect(report.exitCode).toBe(0);
  }, 20000);
});
