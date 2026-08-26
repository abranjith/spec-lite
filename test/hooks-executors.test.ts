import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { runEvent } from "../src/hooks/runner.js";
import { previewHook } from "../src/hooks/preview.js";
import { runHttpHook } from "../src/hooks/executors/http.js";
import { emitAgenticDirective } from "../src/hooks/executors/agentic.js";
import type { HookPayload } from "../src/hooks/types.js";

const execFileAsync = promisify(execFile);
let root: string;

const DISABLE_BUILTINS = [
  { name: "capture-baseline", events: ["implement.pre"], type: "builtin", enabled: false },
  { name: "capture-changeset", events: ["implement.post"], type: "builtin", enabled: false },
];

async function writeHooks(hooks: unknown[]): Promise<void> {
  const file = path.join(root, ".spec-lite", "hooks.json");
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { version: 1, hooks: [...DISABLE_BUILTINS, ...hooks] }, { spaces: 2 });
}

function samplePayload(over: Partial<HookPayload> = {}): HookPayload {
  return {
    hooksVersion: 1,
    event: "implement.post",
    role: "implement",
    phase: "post",
    runId: "RUN1",
    timestamp: "2026-08-21T00:00:00.000Z",
    cwd: "/repo",
    provider: "claude-code",
    feature: { id: "FEAT-012", name: "user_management", dir: ".spec-lite/features/FEAT-012-user_management" },
    summary: "did a thing",
    ...over,
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-exec-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "t@t.local"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
  await fs.writeFile(path.join(root, "a.txt"), "x\n");
  await execFileAsync("git", ["add", "a.txt"], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  await fs.ensureDir(path.join(root, ".spec-lite", "features", "FEAT-001-demo"));
});

afterEach(async () => {
  await fs.remove(root);
});

describe("shell executor delivers the payload three ways", () => {
  it("exposes SPEC_LITE_* environment variables to the hook process", async () => {
    const out = path.join(root, "env-out.txt");
    const write = (v: string) =>
      `node -e "require('fs').writeFileSync(process.env.OUT, ${v})"`;
    await writeHooks([
      {
        name: "env-probe",
        events: ["implement.post"],
        type: "command",
        run: write("[process.env.SPEC_LITE_EVENT, process.env.SPEC_LITE_FEATURE_ID, process.env.SPEC_LITE_FEATURE_DIR].join('|')"),
        env: { OUT: out },
      },
    ]);

    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });

    const content = await fs.readFile(out, "utf-8");
    const [event, featureId, featureDir] = content.split("|");
    expect(event).toBe("implement.post");
    expect(featureId).toBe("FEAT-001");
    expect(featureDir).toBe(".spec-lite/features/FEAT-001-demo");
  });

  it("writes the full payload JSON to SPEC_LITE_PAYLOAD_FILE and to stdin", async () => {
    const out = path.join(root, "payload-out.txt");
    await writeHooks([
      {
        name: "payload-probe",
        events: ["implement.post"],
        type: "command",
        run: `node -e "const p=require(process.env.SPEC_LITE_PAYLOAD_FILE); require('fs').writeFileSync(process.env.OUT, p.event + '|' + p.hooksVersion)"`,
        env: { OUT: out },
      },
    ]);

    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    expect(await fs.readFile(out, "utf-8")).toBe("implement.post|1");
  });
});

describe("once", () => {
  it("skips a hook that already succeeded for the same event on this feature", async () => {
    const counter = path.join(root, "count.txt");
    await writeHooks([
      {
        name: "run-once",
        events: ["implement.post"],
        type: "command",
        once: true,
        run: `node -e "const f=process.env.OUT; const fs=require('fs'); fs.writeFileSync(f, (fs.existsSync(f)?fs.readFileSync(f,'utf8'):'') + 'x')"`,
        env: { OUT: counter },
      },
    ]);

    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    const second = await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });

    expect(await fs.readFile(counter, "utf-8")).toBe("x");
    expect(second.results.find((r) => r.name === "run-once")?.status).toBe("skipped");
    expect(second.results.find((r) => r.name === "run-once")?.message).toContain("already ran once");
  });

  it("runs every time when once is not set", async () => {
    const counter = path.join(root, "count2.txt");
    await writeHooks([
      {
        name: "run-always",
        events: ["implement.post"],
        type: "command",
        run: `node -e "const f=process.env.OUT; const fs=require('fs'); fs.writeFileSync(f, (fs.existsSync(f)?fs.readFileSync(f,'utf8'):'') + 'x')"`,
        env: { OUT: counter },
      },
    ]);

    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    expect(await fs.readFile(counter, "utf-8")).toBe("xx");
  });
});

describe("hook ordering", () => {
  it("runs lower `order` first, then declaration order for ties", async () => {
    const log = path.join(root, "order.txt");
    const append = (label: string) =>
      `node -e "const f=process.env.OUT; const fs=require('fs'); fs.writeFileSync(f, (fs.existsSync(f)?fs.readFileSync(f,'utf8'):'') + '${label}')"`;
    await writeHooks([
      { name: "third", events: ["implement.post"], type: "command", order: 30, run: append("3"), env: { OUT: log } },
      { name: "first", events: ["implement.post"], type: "command", order: 10, run: append("1"), env: { OUT: log } },
      { name: "second", events: ["implement.post"], type: "command", order: 20, run: append("2"), env: { OUT: log } },
    ]);

    await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    expect(await fs.readFile(log, "utf-8")).toBe("123");
  });
});

describe("dry run", () => {
  it("previews without executing and redacts env-sourced secrets", async () => {
    const marker = path.join(root, "never.txt");
    process.env.TEST_HOOK_SECRET = "super-secret-token";
    try {
      await writeHooks([
        {
          name: "would-run",
          events: ["implement.post"],
          type: "command",
          run: `node -e "require('fs').writeFileSync(process.env.OUT,'ran')" \${env:TEST_HOOK_SECRET}`,
          env: { OUT: marker },
        },
      ]);

      const report = await runEvent({ root, event: "implement.post", featureId: "FEAT-001", dryRun: true });
      const result = report.results.find((r) => r.name === "would-run");

      expect(result?.status).toBe("skipped");
      expect(await fs.pathExists(marker)).toBe(false);
      expect(result?.preview).toBeDefined();
      expect(result?.preview).not.toContain("super-secret-token");
      expect(result?.preview).toContain("${env:TEST_HOOK_SECRET}");
    } finally {
      delete process.env.TEST_HOOK_SECRET;
    }
  });
});

describe("http executor", () => {
  it("reports a failure for an unreachable URL", async () => {
    const result = await runHttpHook(
      { name: "dead", events: ["implement.post"], type: "http", url: "http://127.0.0.1:1/none", timeoutMs: 2000 },
      { payload: samplePayload() }
    );
    expect(result.status).toBe("failed");
    expect(result.contractError).toBeUndefined(); // a network failure is runtime, not a contract error
  }, 15000);

  it("treats an unresolvable template as a contract error before any request", async () => {
    const result = await runHttpHook(
      { name: "bad-url", events: ["implement.post"], type: "http", url: "https://x.test/${task.id}" },
      { payload: samplePayload() } // implement.post carries no task
    );
    expect(result.status).toBe("failed");
    expect(result.contractError).toBe(true);
  });

  it("honours onFailure: warn vs abort at the runner level", async () => {
    await writeHooks([
      { name: "dead-warn", events: ["implement.post"], type: "http", url: "http://127.0.0.1:1/none", timeoutMs: 1500, onFailure: "warn" },
    ]);
    const warned = await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    expect(warned.exitCode).toBe(0);

    await writeHooks([
      { name: "dead-abort", events: ["implement.post"], type: "http", url: "http://127.0.0.1:1/none", timeoutMs: 1500, onFailure: "abort" },
    ]);
    const aborted = await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });
    expect(aborted.exitCode).toBe(1);
  }, 25000);

  it("interpolates header values and cannot be made to inject a second header", async () => {
    process.env.TEST_HOOK_TOKEN = "tok-123";
    const received: Record<string, string | undefined>[] = [];
    const server = createServer((req, res) => {
      received.push({ ...req.headers } as Record<string, string | undefined>);
      res.writeHead(204).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runHttpHook(
        {
          name: "with-headers",
          events: ["implement.post"],
          type: "http",
          url: `http://127.0.0.1:${port}/hook`,
          headers: {
            "X-Feature": "${feature.id}",
            Authorization: "Bearer ${env:TEST_HOOK_TOKEN}",
            "X-Summary": "${summary}",
          },
        },
        // A summary carrying CRLF is the injection attempt: without escaping it
        // would terminate the header and start one of the attacker's choosing.
        { payload: samplePayload({ summary: "shipped\r\nX-Evil: yes" }) }
      );

      expect(result.status).toBe("ok");
      const headers = received[0]!;
      expect(headers["x-feature"]).toBe("FEAT-012");
      expect(headers.authorization).toBe("Bearer tok-123");
      expect(headers["x-summary"]).toBe("shipped X-Evil: yes");
      expect(headers["x-evil"]).toBeUndefined();
    } finally {
      delete process.env.TEST_HOOK_TOKEN;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);

  it("treats an unresolvable header template as a contract error before any request", async () => {
    const result = await runHttpHook(
      {
        name: "bad-header",
        events: ["implement.post"],
        type: "http",
        url: "http://127.0.0.1:1/none",
        headers: { "X-Task": "${task.id}" },
      },
      { payload: samplePayload() } // implement.post carries no task
    );
    expect(result.status).toBe("failed");
    expect(result.contractError).toBe(true);
  });

  it("redacts an env-sourced header value in a dry-run preview", () => {
    process.env.TEST_HOOK_TOKEN = "tok-123";
    try {
      const preview = previewHook(
        {
          name: "with-headers",
          events: ["implement.post"],
          type: "http",
          url: "https://example.test/hook",
          headers: { Authorization: "Bearer ${env:TEST_HOOK_TOKEN}" },
        },
        { payload: samplePayload() }
      );
      expect(preview).toContain("Authorization: Bearer ${env:TEST_HOOK_TOKEN}");
      expect(preview).not.toContain("tok-123");
    } finally {
      delete process.env.TEST_HOOK_TOKEN;
    }
  });
});

describe("cwd is interpolated", () => {
  it("runs the hook in the resolved directory", async () => {
    const out = "in-feature-dir.txt";
    await writeHooks([
      {
        name: "writes-relative",
        events: ["implement.post"],
        type: "command",
        cwd: "${feature.dir}",
        run: `node -e "require('fs').writeFileSync('${out}', process.cwd())"`,
      },
    ]);

    const report = await runEvent({ root, event: "implement.post", featureId: "FEAT-001" });

    expect(report.results.find((r) => r.name === "writes-relative")?.status).toBe("ok");
    const written = path.join(root, ".spec-lite", "features", "FEAT-001-demo", out);
    expect(await fs.pathExists(written)).toBe(true);
    expect(await fs.readFile(written, "utf-8")).toContain("FEAT-001-demo");
  }, 15000);
});

describe("agentic kinds are emitted, never executed", () => {
  it("emits a well-formed directive for each agentic kind", () => {
    const cases = [
      { def: { name: "s", events: [], type: "skill" as const, skill: "review", args: "review feature ${feature.name}" }, expectKey: "skill", expectValue: "review" },
      { def: { name: "a", events: [], type: "agent" as const, agent: "spec.reviewer" }, expectKey: "agent", expectValue: "spec.reviewer" },
      { def: { name: "p", events: [], type: "prompt" as const, prompt: "Summarise ${feature.id}" }, expectKey: "prompt", expectValue: "Summarise FEAT-012" },
    ];

    for (const { def, expectKey, expectValue } of cases) {
      const result = emitAgenticDirective(def, { payload: samplePayload() });
      expect(result.status).toBe("emitted");
      const parsed = JSON.parse(result.directive!.replace(/^SPEC-LITE-DIRECTIVE /, ""));
      expect(parsed[expectKey]).toBe(expectValue);
    }
  });

  it("interpolates args without shell escaping, since no shell is involved", () => {
    const result = emitAgenticDirective(
      { name: "s", events: [], type: "skill", skill: "review", args: "review feature ${feature.name}" },
      { payload: samplePayload() }
    );
    const parsed = JSON.parse(result.directive!.replace(/^SPEC-LITE-DIRECTIVE /, ""));
    expect(parsed.args).toBe("review feature user_management");
  });

  it("previews an agentic hook as an instruction, not a command", () => {
    const preview = previewHook(
      { name: "s", events: [], type: "skill", skill: "review", args: "review feature ${feature.name}" },
      { payload: samplePayload() }
    );
    expect(preview).toContain('invoke skill "review"');
    expect(preview).toContain("user_management");
  });
});
