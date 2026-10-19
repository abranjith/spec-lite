import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { runEvent } from "../src/hooks/runner.js";
import {
  decide,
  next,
  startAction,
  completeAction,
  manageDecision,
  recoverAction,
  recoverEvent,
} from "../src/hooks/control/engine.js";
import { Store, atomic } from "../src/hooks/control/store.js";
import { git } from "../src/hooks/builtins/git-workflow.js";
import type { ControlResult } from "../src/hooks/control/types.js";

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

let root: string;
const disable = [
  { name: "capture-baseline", enabled: false },
  { name: "capture-changeset", enabled: false },
];
const cp = (
  event = "plan.post",
  choices: Record<string, unknown> = {
    critique: {
      description: "Critique",
      skill: "plan-critic",
      args: "${plan.file}",
    },
    stop: { description: "Stop", stop: true },
  }
) => ({
  name: "choose",
  type: "builtin",
  builtin: "checkpoint",
  events: [event],
  options: { question: "What next for ${plan.name}?", choices },
});
async function hooks(values: unknown[]) {
  await fs.outputJson(path.join(root, ".spec-lite/hooks.json"), {
    version: 1,
    hooks: [...disable, ...values],
  });
}
const call = async (event: string, opts: Record<string, unknown> = {}) =>
  (await runEvent({
    root,
    event,
    tracked: true,
    extra: { plan: ".spec-lite/plan.md" },
    ...opts,
  })) as unknown as ControlResult;
async function pending(values = [cp()]) {
  await hooks(values);
  const pre = await call("plan.pre");
  expect(pre.status).toBe("continue");
  const post = await call("plan.post", { execution: pre.executionId });
  expect(post.status).toBe("pending");
  return post;
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-control-"));
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  for (const key of [
    "SPEC_LITE_SKIP_HOOKS",
    "SPEC_LITE_HOOK_DEPTH",
    "SPEC_LITE_HOOK_CHAIN",
  ])
    vi.stubEnv(key, "");
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "t@local.test"]);
  await git(root, ["config", "user.name", "test"]);
  await fs.outputFile(path.join(root, ".spec-lite/plan.md"), "# Plan\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "initial"]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.remove(root);
});

describe("portable durable answer and ownership", () => {
  it.each(["generic", "codex", "claude-code", "copilot", "pi"])(
    "runs short chat/resume calls for %s",
    async (provider) => {
      await fs.writeJson(path.join(root, ".spec-lite.json"), { provider });
      const question = await pending();
      const answer = await decide(
        root,
        question.decisionId!,
        "critique",
        "Only review this plan.\nLiteral ${env:SECRET}"
      );
      expect(answer.status).toBe("ready");
      expect(answer.action?.status).toBe("ready");
      const first = await next(root, question.decisionId!);
      const second = await next(root, question.decisionId!);
      expect(first.actionId).toBe(answer.actionId);
      expect(second.startCommand).toBe(first.startCommand);
      expect(second.action?.owner).toBeUndefined();
      const pre = await call("plan-critic.pre", { action: answer.actionId });
      expect(pre.status).toBe("continue");
      expect(pre.executionId).not.toBe(question.executionId);
      const competitor = await call("plan-critic.pre", {
        action: answer.actionId,
      });
      expect(competitor.status).toBe("running");
      expect(competitor.startCommand).toBeUndefined();
      await fs.outputFile(path.join(root, ".spec-lite/review.md"), "ready");
      const post = await call("plan-critic.post", {
        execution: pre.executionId,
        action: answer.actionId,
        extra: {
          plan: ".spec-lite/plan.md",
          report: ".spec-lite/review.md",
          verdict: "Ready",
          verdictCode: "ready",
        },
      });
      expect(post.status).toBe("continue");
      expect((await next(root, question.decisionId!)).action?.status).toBe(
        "completed"
      );
      const store = await Store.open(root);
      const feedback = await fs.readFile(
        store.feedback(question.decisionId!),
        "utf8"
      );
      expect(feedback).toContain("# Scoped decision feedback");
      expect(feedback).toContain("Literal ${env:SECRET}");
    }
  );
  it("serializes answers and competing starts", async () => {
    const question = await pending();
    const answers = await Promise.all([
      decide(root, question.decisionId!, "critique"),
      decide(root, question.decisionId!, "stop"),
    ]);
    expect(
      answers.filter((r) => r.status === "ready" && r.exitCode === 0)
    ).toHaveLength(1);
    const selected = answers.find(
      (r) => r.status === "ready" && r.exitCode === 0
    )!;
    const starts = selected.action?.choice.stop
      ? await Promise.all([
          startAction(root, selected.actionId!, selected.executionId),
          startAction(root, selected.actionId!, selected.executionId),
        ])
      : await Promise.all([
          call("plan-critic.pre", { action: selected.actionId }),
          call("plan-critic.pre", { action: selected.actionId }),
        ]);
    expect(
      starts.filter((r) => r.status === "continue" || r.status === "stopped")
        .length
    ).toBeGreaterThanOrEqual(1);
    const store = await Store.open(root);
    expect(
      (await store.tx((tx) => tx.list("actions"))).filter(
        (a) => a.status === "running"
      )
    ).toHaveLength(selected.action?.choice.stop ? 0 : 1);
  });
  it("requires lifetime scope/context and fences omitted IDs", async () => {
    await hooks([]);
    expect((await call("plan.pre", { extra: {} })).exitCode).toBe(2);
    const pre = await call("plan.pre");
    expect((await call("plan.post")).exitCode).toBe(2);
    expect((await call("plan.pre")).error?.code).toBe("execution-active");
    expect(
      (
        await call("plan.post", {
          execution: pre.executionId,
          extra: { plan: "other/plan.md" },
        })
      ).error?.code
    ).toBe("scope-mismatch");
  });
  it("keeps equal basenames independent and shares guards across linked worktrees", async () => {
    await hooks([cp()]);
    const first = await call("plan.pre");
    const other = await call("plan.pre", { extra: { plan: "other/plan.md" } });
    expect(other.status).toBe("continue");
    expect(other.workflowId).not.toBe(first.workflowId);
    const question = await call("plan.post", { execution: first.executionId });
    expect(question.status).toBe("pending");
    const linked = path.join(root, "linked");
    await git(root, ["worktree", "add", "-qb", "linked", linked]);
    const otherStore = await Store.open(linked);
    expect(otherStore.root).toBe((await Store.open(root)).root);
    expect(
      (
        (await runEvent({
          root: linked,
          event: "plan.pre",
          tracked: true,
          extra: { plan: ".spec-lite/plan.md" },
        })) as unknown as ControlResult
      ).error?.code
    ).toBe("workflow-paused");
    await git(root, ["worktree", "remove", "--force", linked]);
  });
});
describe("continuations, snapshots and management", () => {
  it("does not run the suffix until continue and cancels it on replacement/stop", async () => {
    const marker = path.join(root, "effect");
    const effect = {
      name: "effect",
      events: ["plan.post"],
      type: "command",
      run: "node -e \"require('fs').writeFileSync('effect','done')\"",
    };
    const question = await pending([
      cp("plan.post", {
        go: { description: "Continue", continue: true },
        stop: { description: "Stop", stop: true },
      }),
      effect,
    ]);
    expect(await fs.pathExists(marker)).toBe(false);
    const answered = await decide(root, question.decisionId!, "go");
    expect(await fs.pathExists(marker)).toBe(false);
    const continued = await startAction(
      root,
      answered.actionId!,
      question.executionId
    );
    expect(continued.status).toBe("continue");
    expect(await fs.readFile(marker, "utf8")).toBe("done");
    expect(
      (await startAction(root, answered.actionId!, question.executionId)).status
    ).toBe("completed");
  });
  it("supersedes relevant changed approvals but ignores unrelated files", async () => {
    const question = await pending();
    await fs.writeFile(path.join(root, "unrelated"), "x");
    expect((await next(root, question.decisionId!)).status).toBe("pending");
    await fs.writeFile(path.join(root, ".spec-lite/plan.md"), "changed");
    expect((await decide(root, question.decisionId!, "critique")).status).toBe(
      "superseded"
    );
    const reissued = await manageDecision(
      root,
      question.decisionId!,
      "reissue",
      "User requests approval of revised plan"
    );
    expect(reissued.decisionId).not.toBe(question.decisionId);
    expect(reissued.status).toBe("pending");
    expect((await decide(root, question.decisionId!, "stop")).exitCode).toBe(1);
    const answer = await decide(root, reissued.decisionId!, "critique");
    await fs.writeFile(path.join(root, ".spec-lite/plan.md"), "changed again");
    expect(
      (await call("plan-critic.pre", { action: answer.actionId })).status
    ).toBe("superseded");
  });
  it("expiry/cancel/wait never permits continuation", async () => {
    const question = await pending();
    expect((await next(root, question.decisionId!, "1ms")).wait).toBe(
      "timeout"
    );
    await manageDecision(
      root,
      question.decisionId!,
      "cancel",
      "User cancelled"
    );
    expect((await decide(root, question.decisionId!, "critique")).status).toBe(
      "cancelled"
    );
    const replacement = await manageDecision(
      root,
      question.decisionId!,
      "reissue",
      "User asks again"
    );
    const store = await Store.open(root);
    await store.tx(async (tx) => {
      const d = await tx.require("decisions", replacement.decisionId!);
      d.expiresAt = new Date(0).toISOString();
      tx.put("decisions", d);
    });
    expect((await next(root, replacement.decisionId!)).status).toBe("expired");
    expect((await decide(root, replacement.decisionId!, "stop")).exitCode).toBe(
      1
    );
    expect((await call("plan.pre")).error?.code).toBe("workflow-paused");
    expect((await next(root, undefined, "1s")).exitCode).toBe(2);
    expect((await next(root, replacement.decisionId!, "100h")).exitCode).toBe(
      2
    );
  });
  it("reported targets need acknowledgements and stale completions are fenced", async () => {
    const question = await pending([
      cp("plan.post", {
        task: {
          description: "External task",
          prompt: "Read the plan and answer",
          completion: "reported",
        },
        stop: { description: "Stop", stop: true },
      }),
    ]);
    const answer = await decide(root, question.decisionId!, "task");
    const started = await startAction(root, answer.actionId!);
    expect(started.status).toBe("started");
    expect(
      (
        await manageDecision(
          root,
          question.decisionId!,
          "reissue",
          "User asks again"
        )
      ).error?.code
    ).toBe("owner-active");
    const recovered = await recoverAction(
      root,
      answer.actionId!,
      1,
      "retry",
      "User reconciled interrupted task; retry"
    );
    expect(recovered.status).toBe("ready");
    expect(recovered.action?.generation).toBe(2);
    expect(
      (
        await completeAction(
          root,
          answer.actionId!,
          started.executionId!,
          "success"
        )
      ).error?.code
    ).toBe("stale-owner");
    const restarted = await startAction(root, answer.actionId!);
    expect(restarted.status).toBe("started");
    expect(
      (
        await completeAction(
          root,
          answer.actionId!,
          restarted.executionId!,
          "success"
        )
      ).status
    ).toBe("completed");
  });
});
describe("gates and replay boundaries", () => {
  const gate = (run: string, more = {}) => ({
    name: "check",
    type: "command",
    events: ["plan.post"],
    gate: true,
    onFailure: "abort",
    run,
    ...more,
  });
  const write = (value: unknown) =>
    `node -e "require('fs').writeFileSync(process.env.SPEC_LITE_RESPONSE_FILE,Buffer.from('${Buffer.from(JSON.stringify(value)).toString("base64")}','base64'))"`;
  it("shows the exact recover command once the retry budget is spent", async () => {
    await hooks([
      gate(write({ decision: "block", reason: "fix lint" }), { maxRounds: 1 }),
    ]);
    const pre = await call("plan.pre");
    const post = await call("plan.post", { execution: pre.executionId });
    expect(post.status).toBe("blocked");
    expect(post.retryAllowed).toBe(false);
    expect(post.recovery).toBe(
      `spec-lite hook recover ${post.eventId} --generation 1 --mode retry|stop|override --reason <user-instruction> (override needs --checks check)`
    );
  });
  it("requires a tracked run before any effects", async () => {
    await hooks([gate(write({ decision: "continue" }))]);
    const output = await runEvent({
      root,
      event: "plan.post",
      extra: { plan: ".spec-lite/plan.md" },
    });
    expect(output.exitCode).toBe(2);
    expect(output.status).toBe("error");
  });
  it.each([
    "",
    "no json",
    '{"decision":"continue","extra":true}',
    '{"decision":"yes"}',
    "x".repeat(65537),
  ])("fails closed for response case %#", async (body) => {
    await hooks([
      gate(
        `node -e "require('fs').writeFileSync(process.env.SPEC_LITE_RESPONSE_FILE,Buffer.from('${Buffer.from(body).toString("base64")}','base64'))"`
      ),
    ]);
    const pre = await call("plan.pre");
    const post = await call("plan.post", { execution: pre.executionId });
    expect(post.exitCode).toBe(1);
    expect(post.status).toBe("interrupted");
  });
  it("counts total rounds durably, never falls through or resets with omitted IDs", async () => {
    await hooks([
      gate(write({ decision: "block", reason: "fix lint" })),
      {
        name: "effect",
        type: "command",
        events: ["plan.post"],
        run: "node -e \"require('fs').writeFileSync('effect','ran')\"",
      },
    ]);
    const pre = await call("plan.pre");
    const first = await call("plan.post", { execution: pre.executionId });
    expect(first.status).toBe("blocked");
    expect(first.retryAllowed).toBe(true);
    const second = await call("plan.post", {
      execution: pre.executionId,
      retry: first.eventId,
    });
    expect(second.status).toBe("blocked");
    const third = await call("plan.post", {
      execution: pre.executionId,
      retry: first.eventId,
    });
    expect(third.retryAllowed).toBe(false);
    const fourth = await call("plan.post", {
      execution: pre.executionId,
      retry: first.eventId,
    });
    expect(fourth.retryAllowed).toBe(false);
    expect(await fs.pathExists(path.join(root, "effect"))).toBe(false);
    expect((await call("plan.pre")).error?.code).toBe("workflow-paused");
    const overridden = await recoverEvent(
      root,
      first.eventId!,
      1,
      "override",
      "User overrides lint for this event",
      ["check"]
    );
    expect(overridden.status).toBe("continue");
    expect(
      overridden.results.find(
        (r) => r.name === "check" && r.status === "skipped"
      )?.message
    ).toContain("not a passed");
  });
});
describe("crash reconciliation and dry run", () => {
  it("replays multi-record intents, ignores torn temp files, and never fabricates an owner", async () => {
    const question = await pending();
    const store = await Store.open(root);
    const original = await store.tx((tx) =>
      tx.require("decisions", question.decisionId!)
    );
    const altered = { ...original, reason: "Recovered journal" };
    await atomic(path.join(store.root, "intent.json"), [
      { file: store.file("decisions", original.id), value: altered },
    ]);
    await fs.outputFile(
      path.join(store.root, "actions", "a-torn.write-torn.tmp"),
      "partial"
    );
    expect((await next(root, original.id)).decision?.reason).toBe(
      "Recovered journal"
    );
    expect((await next(root)).exitCode).toBe(0);
    expect(await fs.pathExists(path.join(store.root, "intent.json"))).toBe(
      false
    );
  });
  it("is side effect free before any runtime exists", async () => {
    await hooks([cp()]);
    const before = await fs.readdir(path.join(root, ".git"));
    const report = await call("plan.pre", { dryRun: true });
    expect(report.exitCode).toBe(0);
    expect(await fs.pathExists(path.join(root, ".git/spec-lite"))).toBe(false);
    expect(await fs.readdir(path.join(root, ".git"))).toEqual(before);
  });
});
