/** Regressions for .spec-lite/reviews/review_hook-flow-control.md (REV-001 … REV-016). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { runEvent } from "../src/hooks/runner.js";
import { decide, next, manageDecision, recoverExecution, recoverEvent, pruneRuntime, RETENTION_MS } from "../src/hooks/control/engine.js";
import { Store } from "../src/hooks/control/store.js";
import { takeSnapshot } from "../src/hooks/control/snapshot.js";
import { git } from "../src/hooks/builtins/git-workflow.js";
import { validateBuiltinOptions } from "../src/hooks/builtins/options.js";
import { publicView } from "../src/commands/control.js";
import type { ControlResult } from "../src/hooks/control/types.js";
import type { ResolvedHook } from "../src/hooks/types.js";

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

let root: string;
const disable = [{ name: "capture-baseline", enabled: false }, { name: "capture-changeset", enabled: false }];
const cp = { name: "choose", type: "builtin", builtin: "checkpoint", events: ["plan.post"], options: { question: "Next for ${plan.name}?", choices: { critique: { description: "Critique", skill: "plan-critic" }, stop: { description: "Stop", stop: true } } } };
async function hooks(values: unknown[]) { await fs.outputJson(path.join(root, ".spec-lite/hooks.json"), { version: 1, hooks: [...disable, ...values] }); }
const call = async (event: string, opts: Record<string, unknown> = {}) => await runEvent({ root, event, protocol: 2, extra: { plan: ".spec-lite/plan.md" }, ...opts }) as unknown as ControlResult;
async function initRepo() { await git(root, ["init", "-q"]); await git(root, ["config", "user.email", "t@local.test"]); await git(root, ["config", "user.name", "test"]); await git(root, ["add", "."]); await git(root, ["commit", "-qm", "initial", "--allow-empty"]); }
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-review-fixes-")));
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
  for (const key of ["SPEC_LITE_SKIP_HOOKS", "SPEC_LITE_HOOK_DEPTH", "SPEC_LITE_HOOK_CHAIN"]) vi.stubEnv(key, "");
  await fs.outputFile(path.join(root, ".spec-lite/plan.md"), "# Plan\n");
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.remove(root); });

describe("REV-001 protocol 2 outside Git", () => {
  it("continues statelessly with no hooks, with hooks disabled, and runs stateless hooks", async () => {
    const plain = await call("plan.pre");
    expect(plain.status).toBe("continue"); expect(plain.exitCode).toBe(0); expect(plain.executionId).toBeUndefined();
    await hooks([{ name: "note", type: "command", events: ["plan.pre"], run: "node -e \"require('fs').writeFileSync('ran','1')\"" }]);
    const withHook = await call("plan.pre");
    expect(withHook.status).toBe("continue"); expect(await fs.pathExists(path.join(root, "ran"))).toBe(true);
    await fs.writeJson(path.join(root, ".spec-lite.json"), { hooks: { enabled: false } });
    expect((await call("plan.post")).status).toBe("continue");
  });
  it("still refuses durable hooks visibly", async () => {
    await hooks([cp]);
    const result = await call("plan.post");
    expect(result.status).toBe("error"); expect(result.error?.code).toBe("git-required");
  });
});

describe("in a Git checkout", () => {
  beforeEach(initRepo);

  it("REV-002 lists an abandoned execution and resumes or stops it on instruction", async () => {
    await hooks([]);
    const pre = await call("plan.pre");
    expect((await call("plan.pre")).error?.recovery).toContain(`execution recover ${pre.executionId}`);
    const listed = await next(root);
    const item = listed.items?.find((i) => i.executionId === pre.executionId);
    expect(item?.status).toBe("running"); expect(item?.recovery).toContain("--mode resume|stop");
    expect((await recoverExecution(root, pre.executionId!, 9, "resume", "user said resume")).error?.code).toBe("stale-generation");
    expect((await recoverExecution(root, pre.executionId!, 1, "resume", "")).error?.code).toBe("reason-required");
    const resumed = await recoverExecution(root, pre.executionId!, 1, "resume", "user said resume");
    expect(resumed.executionId).toBe(pre.executionId); expect(resumed.context?.generation).toBe(2);
    expect((await call("plan.post", { execution: pre.executionId })).status).toBe("continue");
    const second = await call("plan.pre");
    const stopped = await recoverExecution(root, second.executionId!, 1, "stop", "user said start over");
    expect(stopped.status).toBe("stopped");
    expect((await call("plan.pre")).status).toBe("continue");
  });

  it("REV-002 stop releases a paused checkpoint and cancels its question", async () => {
    await hooks([cp]);
    const pre = await call("plan.pre");
    const post = await call("plan.post", { execution: pre.executionId }); expect(post.status).toBe("pending");
    expect((await recoverExecution(root, pre.executionId!, 1, "stop", "abandon")).status).toBe("stopped");
    expect((await decide(root, post.decisionId!, "critique")).error?.code).toBe("decision-terminal");
    expect((await call("plan.pre")).status).toBe("continue");
  });

  it("REV-005 blocks only legacy calls whose scope is paused", async () => {
    await hooks([cp]);
    const pre = await call("plan.pre");
    expect((await call("plan.post", { execution: pre.executionId })).status).toBe("pending");
    const unscoped = await runEvent({ root, event: "brainstorm.pre" });
    expect(unscoped.exitCode).toBe(0);
    const scoped = await runEvent({ root, event: "plan.pre", extra: { plan: ".spec-lite/plan.md" } }) as unknown as ControlResult;
    expect(scoped.error?.code).toBe("protocol-required");
  });

  it("REV-006 hides terminal history by default and prunes old terminal workflows", async () => {
    await hooks([cp]);
    const pre = await call("plan.pre");
    const post = await call("plan.post", { execution: pre.executionId });
    await fs.appendFile(path.join(root, ".spec-lite/plan.md"), "edited\n");
    expect((await decide(root, post.decisionId!, "critique")).error?.code).toBe("snapshot-changed");
    await manageDecision(root, post.decisionId!, "cancel", "user cancelled");
    expect((await recoverEvent(root, post.eventId!, 1, "stop", "user stopped")).status).toBe("stopped");
    expect((await next(root)).items?.some((i) => i.decisionId === post.decisionId)).toBe(false);
    expect((await next(root, undefined, undefined, undefined, true)).items?.some((i) => i.decisionId === post.decisionId)).toBe(true);

    await fs.outputFile(path.join(root, ".spec-lite/other.md"), "# Other\n");
    const paused = await call("plan.pre", { extra: { plan: ".spec-lite/other.md" } });
    expect((await call("plan.post", { execution: paused.executionId, extra: { plan: ".spec-lite/other.md" } })).status).toBe("pending");
    const store = await Store.open(root);
    expect(await pruneRuntime(store, Date.now())).toEqual([]);
    const pruned = await pruneRuntime(store, Date.now() + RETENTION_MS + 1000);
    expect(pruned).toEqual([post.workflowId]);
    expect(await fs.pathExists(store.file("workflows", post.workflowId!))).toBe(false);
    expect(await fs.pathExists(store.file("workflows", paused.workflowId!))).toBe(true);
    expect((await next(root)).items?.some((i) => i.decisionId)).toBe(true);
  });

  it("REV-013 renders without stored snapshots unless verbose", async () => {
    await hooks([cp]);
    const pre = await call("plan.pre");
    const post = await call("plan.post", { execution: pre.executionId });
    const view = publicView(post);
    expect(post.decision?.snapshot).toBeDefined();
    expect((view.decision as unknown as Record<string, unknown>).snapshot).toBeUndefined();
    expect(view.decision?.choices).toEqual(post.decision?.choices);
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(post).length / 1.5);
  });

  it("REV-014 notices a local answer quickly while waiting", async () => {
    await hooks([cp]);
    const pre = await call("plan.pre");
    const post = await call("plan.post", { execution: pre.executionId });
    const started = Date.now();
    const waiting = next(root, post.decisionId!, "20s");
    setTimeout(() => void decide(root, post.decisionId!, "critique"), 300);
    const result = await waiting;
    expect(result.status).toBe("ready"); expect(Date.now() - started).toBeLessThan(8000);
  });

  it("REV-015 withholds payload-sourced attachments outside .spec-lite", async () => {
    await fs.outputFile(path.join(root, "config/secrets.yaml"), "token: x\n");
    const hook = { name: "ask", type: "builtin", builtin: "checkpoint", events: ["plan.post"], source: "project", enabled: true, options: { question: "q", attach: ["${plan.file}", "config/secrets.yaml"], choices: { a: { description: "A", stop: true }, b: { description: "B", stop: true } } } } as unknown as ResolvedHook;
    const outside = await takeSnapshot(root, hook, { event: "plan.post", plan: "config/secrets.yaml" } as never, {});
    expect(outside.files.find((f) => f.path === "config/secrets.yaml")).toMatchObject({ publish: true });
    const viaPayload = await takeSnapshot(root, { ...hook, options: { ...hook.options, attach: ["${plan.file}"] } } as ResolvedHook, { event: "plan.post", plan: "config/secrets.yaml" } as never, {});
    expect(viaPayload.files[0]).toMatchObject({ path: "config/secrets.yaml", publish: false, withheld: true });
    const inside = await takeSnapshot(root, { ...hook, options: { ...hook.options, attach: ["${plan.file}"] } } as ResolvedHook, { event: "plan.post", plan: ".spec-lite/plan.md" } as never, {});
    expect(inside.files[0]).toMatchObject({ path: ".spec-lite/plan.md", publish: true });
  });
});

describe("option validation", () => {
  it("REV-011 rejects whitespace-only strings and a blank program name", () => {
    expect(validateBuiltinOptions("prepare-worktree", { fromBranch: "   " }).errors.length).toBeGreaterThan(0);
    expect(validateBuiltinOptions("checkpoint", { question: "  ", choices: { a: { description: "A", stop: true }, b: { description: "B", stop: true } } }).errors.length).toBeGreaterThan(0);
  });
  it("REV-016 warns when a GitHub checkpoint has no explicit approvers", () => {
    const options = { question: "q", choices: { a: { description: "A", stop: true }, b: { description: "B", stop: true } }, github: { target: "issue" } };
    expect(validateBuiltinOptions("checkpoint", options).warnings.join(" ")).toContain("approvers");
    expect(validateBuiltinOptions("checkpoint", { ...options, github: { target: "issue", approvers: ["someone"] } }).warnings).toEqual([]);
  });
});
