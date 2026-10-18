import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { git } from "../src/hooks/builtins/git-workflow.js";
import { runEvent, type RunEventOptions } from "../src/hooks/runner.js";
import {
  decide,
  next,
  startAction,
  completeAction,
  manageDecision,
  recoverEvent,
} from "../src/hooks/control/engine.js";
import { Store } from "../src/hooks/control/store.js";
import type { ControlResult } from "../src/hooks/control/types.js";
import { getProvider } from "../src/providers/index.js";
import { loadAllSources } from "../src/utils/prompts.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
let root: string;
const plan = ".spec-lite/plan_orders.md";
const choices = {
  continue: { description: "Continue", continue: true },
  stop: { description: "Stop", stop: true },
};

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "spec-lite-control-regression-")
  );
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  await git(root, ["init", "-b", "main"]);
  await fs.outputFile(path.join(root, plan), "# Orders\n");
  await fs.outputFile(
    path.join(root, ".spec-lite/reviews/report.md"),
    "# Review report\n"
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(root);
});
const configure = (hooks: unknown[]) =>
  fs.outputJson(path.join(root, ".spec-lite/hooks.json"), {
    version: 1,
    hooks,
  });
const checkpoint = (event: string, options: Record<string, unknown> = {}) => ({
  name: "route",
  events: [event],
  type: "builtin",
  builtin: "checkpoint",
  options: { question: "What next?", choices, ...options },
});
const fire = async (event: string, options: Partial<RunEventOptions> = {}) =>
  (await runEvent({
    root,
    event,
    protocol: 2,
    ...options,
  })) as unknown as ControlResult;

describe("flow-control integration regressions", () => {
  it("pauses a persisted self-route across separate role executions", async () => {
    await configure([
      {
        name: "again",
        events: ["review.post"],
        type: "skill",
        skill: "review",
      },
    ]);
    const started = await fire("review.pre", {
      extra: { scope: "orders-review" },
    });
    const report = {
      report: ".spec-lite/reviews/report.md",
      verdict: "Approve",
      verdictCode: "pass",
    };
    const ready = await fire("review.post", {
      execution: started.executionId,
      extra: report,
    });
    expect(ready.status).toBe("ready");
    const routed = await fire("review.pre", { action: ready.actionId });
    expect(routed.status, JSON.stringify(routed.error)).toBe("continue");
    const paused = await fire("review.post", {
      execution: routed.executionId,
      action: ready.actionId,
      extra: report,
    });
    expect(paused.status, JSON.stringify(paused.error)).toBe("paused");
    expect(paused.retryAllowed).toBe(false);
    expect(paused.actionId).toBeUndefined();
    const repeated = await fire("review.post", {
      execution: routed.executionId,
      action: ready.actionId,
      extra: report,
    });
    expect(repeated.status).toBe("paused");
    expect(repeated.eventId).toBe(paused.eventId);
  });

  it("can explicitly stop a stale static action using its reported event generation", async () => {
    await configure([
      {
        name: "inspect",
        events: ["plan.post"],
        type: "prompt",
        prompt: "Inspect ${plan.file}",
        completion: "reported",
      },
    ]);
    const started = await fire("plan.pre", { extra: { plan } });
    const ready = await fire("plan.post", { execution: started.executionId });
    await fs.writeFile(path.join(root, plan), "# Changed plan\n");
    const stale = await startAction(root, ready.actionId!);
    expect(stale.status).toBe("superseded");
    const store = await Store.open(root);
    const saved = await store.tx((tx) => tx.require("events", ready.eventId!));
    expect(stale.error?.recovery).toContain(`--generation ${saved.generation}`);
    const stopped = await recoverEvent(
      root,
      ready.eventId!,
      saved.generation,
      "stop",
      "User stops stale work"
    );
    expect(stopped.status, JSON.stringify(stopped.error)).toBe("stopped");
    expect((await fire("plan.pre", { extra: { plan } })).status).toBe(
      "continue"
    );
  });

  it("can explicitly stop a cancelled question while retaining the cancelled answer record", async () => {
    await configure([checkpoint("plan.post")]);
    const started = await fire("plan.pre", { extra: { plan } });
    const pending = await fire("plan.post", { execution: started.executionId });
    expect(
      (
        await manageDecision(
          root,
          pending.decisionId!,
          "cancel",
          "User cancels question"
        )
      ).status
    ).toBe("cancelled");
    const store = await Store.open(root);
    const saved = await store.tx((tx) =>
      tx.require("events", pending.eventId!)
    );
    expect(
      (
        await recoverEvent(
          root,
          pending.eventId!,
          saved.generation,
          "stop",
          "User stops this workflow"
        )
      ).status
    ).toBe("stopped");
    expect(
      (await store.tx((tx) => tx.require("decisions", pending.decisionId!)))
        .status
    ).toBe("cancelled");
  });

  it("reports stale lock recovery ownership and reclaims only after explicit reconciliation", async () => {
    const store = await Store.open(root);
    const lock = path.join(store.root, "locks/control.lock");
    const reaper = `${lock}.reaping`;
    await fs.outputJson(lock, {
      pid: 2147483647,
      host: os.hostname(),
      token: "old-owner",
    });
    await fs.outputJson(reaper, {
      pid: 2147483647,
      host: os.hostname(),
      token: "old-reaper",
    });
    const busy = await next(root);
    expect(busy.exitCode).toBe(4);
    expect(busy.error?.code).toBe("stale-reaper");
    expect(busy.error?.recovery).toContain(reaper);
    expect(await fs.pathExists(lock)).toBe(true);
    await fs.remove(reaper);
    expect((await next(root)).exitCode).toBe(0);
    expect(await fs.pathExists(lock)).toBe(false);
  });

  it("continues a paused pre suffix without replaying it or losing the role context", async () => {
    await fs.writeFile(
      path.join(root, "suffix.mjs"),
      "import fs from 'node:fs'; fs.appendFileSync('suffix.txt', 'once\\n');"
    );
    await configure([
      checkpoint("plan.pre"),
      {
        name: "suffix",
        events: ["plan.pre"],
        type: "script",
        run: "node suffix.mjs",
        order: 100,
      },
    ]);
    const paused = await fire("plan.pre", { extra: { plan } });
    expect(paused.status).toBe("pending");
    expect(await fs.pathExists(path.join(root, "suffix.txt"))).toBe(false);
    const answer = await decide(root, paused.decisionId!, "continue");
    const resumed = await startAction(
      root,
      answer.actionId!,
      paused.executionId
    );
    expect(resumed.status).toBe("continue");
    expect(resumed.executionId).toBe(paused.executionId);
    const repeated = await startAction(
      root,
      answer.actionId!,
      paused.executionId
    );
    expect(repeated.status).toBe("completed");
    expect(await fs.readFile(path.join(root, "suffix.txt"), "utf8")).toBe(
      "once\n"
    );
    const completed = await fire("plan.post", {
      execution: paused.executionId,
      extra: { summary: "Finished" },
    });
    expect(completed.exitCode).toBe(0);
  });

  it("retains Plan Feature scope when recording the newly allocated feature", async () => {
    const started = await fire("plan-feature.pre", {
      extra: { scope: "feature-planning:orders" },
    });
    expect(started.status).toBe("continue");
    await fs.outputFile(
      path.join(root, ".spec-lite/features/FEAT-001-orders/spec.md"),
      "# Orders\n"
    );
    const recorded = await fire("feature.spec.post", {
      execution: started.executionId,
      featureId: "FEAT-001",
    });
    expect(recorded.exitCode, JSON.stringify(recorded.error)).toBe(0);
    expect(recorded.workflowId).toBe(started.workflowId);
    const completed = await fire("plan-feature.post", {
      execution: started.executionId,
      featureId: "FEAT-001",
      extra: { summary: "Spec written" },
    });
    expect(completed.exitCode, JSON.stringify(completed.error)).toBe(0);
  });

  it("records multiple feature items inside one plan-scoped Feature execution", async () => {
    const started = await fire("feature.pre", { extra: { plan } });
    for (const feature of ["FEAT-001", "FEAT-002"]) {
      await fs.outputFile(
        path.join(root, `.spec-lite/features/${feature}-orders/spec.md`),
        "# Orders\n"
      );
      const recorded = await fire("feature.spec.post", {
        execution: started.executionId,
        featureId: feature,
      });
      expect(recorded.exitCode, JSON.stringify(recorded.error)).toBe(0);
      expect(recorded.workflowId).toBe(started.workflowId);
    }
    const completed = await fire("feature.post", {
      execution: started.executionId,
      extra: { plan, summary: "2 specs" },
    });
    expect(completed.exitCode, JSON.stringify(completed.error)).toBe(0);
  });

  it("starts a templated static prompt using its frozen declaration", async () => {
    await configure([
      {
        name: "inspect",
        events: ["plan.post"],
        type: "prompt",
        prompt: "Inspect ${plan.file}",
        completion: "reported",
      },
    ]);
    const started = await fire("plan.pre", { extra: { plan } });
    const ready = await fire("plan.post", {
      execution: started.executionId,
      extra: { summary: "Ready" },
    });
    expect(ready.status).toBe("ready");
    const claimed = await startAction(root, ready.actionId!);
    expect(claimed.status, JSON.stringify(claimed.error)).toBe("started");
    expect(claimed.action?.choice.prompt).toBe(`Inspect ${plan}`);
    expect(
      (
        await completeAction(
          root,
          ready.actionId!,
          claimed.executionId!,
          "success"
        )
      ).status
    ).toBe("completed");
  });

  it("does not send pending notifications for an immediate rule resolution", async () => {
    await fs.writeFile(
      path.join(root, "pending.mjs"),
      "import fs from 'node:fs'; fs.appendFileSync('pending.txt', 'notified');"
    );
    await configure([
      checkpoint("plan-critic.post", {
        rules: [{ if: { "verdict.code": "ready" }, choose: "continue" }],
      }),
      {
        name: "notify",
        events: ["checkpoint.pending"],
        type: "script",
        run: "node pending.mjs",
      },
    ]);
    const started = await fire("plan-critic.pre", { extra: { plan } });
    const resolved = await fire("plan-critic.post", {
      execution: started.executionId,
      extra: {
        report: ".spec-lite/reviews/report.md",
        verdict: "Ready",
        verdictCode: "ready",
        summary: "Ready",
      },
    });
    expect(resolved.status, JSON.stringify(resolved.error)).toBe("ready");
    expect(await fs.pathExists(path.join(root, "pending.txt"))).toBe(false);
  });

  it("does not invalidate an approval when an equivalent provider wrapper is installed", async () => {
    await configure([
      checkpoint("plan.post", {
        choices: {
          critique: {
            description: "Critique",
            skill: "plan-critic",
            args: "${plan.file}",
          },
          stop: choices.stop,
        },
      }),
    ]);
    const sources = await loadAllSources();
    const source = sources.find(
      (item) => item.name.replace(/_/g, "-") === "plan-critic"
    )!;
    const meta = {
      name: "plan_critic",
      title: source.title,
      description: source.description,
    };
    const claude = getProvider("claude-code")!;
    const claudePath = claude.getOutputPaths("plan_critic").prompt;
    await fs.outputFile(
      path.join(root, claudePath),
      claude.transformPrompt(source.content, meta)
    );
    const started = await fire("plan.pre", { extra: { plan } });
    const paused = await fire("plan.post", {
      execution: started.executionId,
      extra: { summary: "Ready" },
    });
    await decide(root, paused.decisionId!, "critique");
    const codex = getProvider("codex")!;
    await fs.outputFile(
      path.join(root, codex.getSkillOutputDir!("plan-critic"), "SKILL.md"),
      source.content
    );
    const inspected = await next(root, paused.decisionId);
    expect(inspected.status, JSON.stringify(inspected.error)).toBe("ready");
  });

  it("ignores abandoned atomic-write files while listing valid saved work", async () => {
    await configure([checkpoint("plan.post")]);
    const started = await fire("plan.pre", { extra: { plan } });
    const paused = await fire("plan.post", {
      execution: started.executionId,
      extra: { summary: "Ready" },
    });
    const store = await Store.open(root);
    await fs.outputFile(
      path.join(store.root, "workflows", "w-abandoned.write-token.tmp"),
      "partial"
    );
    await fs.outputFile(
      path.join(store.root, "decisions", "write-orphan.tmp"),
      "partial"
    );
    const inspected = await next(root);
    expect(inspected.exitCode, JSON.stringify(inspected.error)).toBe(0);
    expect(
      inspected.items?.some((item) => item.decisionId === paused.decisionId)
    ).toBe(true);
  });

  it("keeps equivalent local instruction overrides when transferring providers", async () => {
    await configure([
      checkpoint("plan.post", {
        choices: {
          critique: {
            description: "Critique",
            skill: "plan-critic",
            args: "${plan.file}",
          },
          stop: choices.stop,
        },
      }),
    ]);
    const source = (await loadAllSources()).find(
      (item) => item.name.replace(/_/g, "-") === "plan-critic"
    )!;
    const content =
      source.content +
      "\nLocal instruction: include migration feasibility in the critique.\n";
    const meta = {
      name: "plan_critic",
      title: source.title,
      description: source.description,
    };
    const claude = getProvider("claude-code")!;
    await fs.outputFile(
      path.join(root, claude.getOutputPaths("plan_critic").prompt),
      claude.transformPrompt(content, meta)
    );
    const started = await fire("plan.pre", { extra: { plan } });
    const paused = await fire("plan.post", {
      execution: started.executionId,
      extra: { summary: "Ready" },
    });
    await decide(root, paused.decisionId!, "critique");
    const codex = getProvider("codex")!;
    await fs.outputFile(
      path.join(root, codex.getSkillOutputDir!("plan-critic"), "SKILL.md"),
      content
    );
    const inspected = await next(root, paused.decisionId);
    expect(inspected.status, JSON.stringify(inspected.error)).toBe("ready");
  });

  it("retains once and local feature-audit semantics for updated role callers", async () => {
    await fs.outputFile(
      path.join(root, ".spec-lite/features/FEAT-001-orders/spec.md"),
      "# Orders\n"
    );
    await fs.writeFile(
      path.join(root, "once.mjs"),
      "import fs from 'node:fs'; fs.appendFileSync('once.txt', 'once\\n');"
    );
    await configure([
      {
        name: "once",
        events: ["review.post"],
        type: "script",
        run: "node once.mjs",
        once: true,
      },
    ]);
    for (let index = 0; index < 2; index++) {
      const started = await fire("review.pre", { featureId: "FEAT-001" });
      const completed = await fire("review.post", {
        execution: started.executionId,
        featureId: "FEAT-001",
        extra: {
          report: ".spec-lite/reviews/report.md",
          verdict: "Approve",
          verdictCode: "pass",
          summary: "Reviewed",
        },
      });
      expect(completed.exitCode, JSON.stringify(completed.error)).toBe(0);
    }
    expect(await fs.readFile(path.join(root, "once.txt"), "utf8")).toBe(
      "once\n"
    );
    const audit = path.join(
      root,
      ".spec-lite/features/FEAT-001-orders/hooks.log.jsonl"
    );
    expect(await fs.pathExists(audit)).toBe(true);
    expect(
      (await git(root, ["check-ignore", "--", path.relative(root, audit)]))
        .length
    ).toBeGreaterThan(0);
  });

  it("still invokes configured hook.error diagnostics on a durable failure", async () => {
    await fs.writeFile(path.join(root, "fail.mjs"), "process.exit(1);");
    await fs.writeFile(
      path.join(root, "error.mjs"),
      "import fs from 'node:fs'; fs.writeFileSync('failure-notified.txt', 'failure');"
    );
    await configure([
      {
        name: "fail",
        events: ["plan.post"],
        type: "script",
        run: "node fail.mjs",
        onFailure: "abort",
      },
      {
        name: "error-log",
        events: ["hook.error"],
        type: "script",
        run: "node error.mjs",
      },
    ]);
    const started = await fire("plan.pre", { extra: { plan } });
    const failed = await fire("plan.post", {
      execution: started.executionId,
      extra: { summary: "Ready" },
    });
    expect(failed.exitCode).toBe(1);
    expect(await fs.pathExists(path.join(root, "failure-notified.txt"))).toBe(
      true
    );
  });
});
