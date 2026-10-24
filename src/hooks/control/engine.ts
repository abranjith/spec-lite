/** Tracked runs. The CLI records routing; role bodies are executed by the caller. */
import path from "node:path";
import fs from "fs-extra";
import { refreshChanges } from "../payload.js";
import { getEvent } from "../events.js";
import { hooksForEvent, loadRegistry } from "../registry.js";
import {
  resolveTemplate,
  describeVars,
  missingRequirements,
  requirementsMessage,
} from "../interpolation.js";
import {
  readProjectConfig,
  hooksLogPath,
  isSafeWorkName,
} from "../workspace.js";
import { validatePayloadForHook } from "../payload-validation.js";
import { runShellHook } from "../executors/shell.js";
import { runHttpHook } from "../executors/http.js";
import { runBuiltinHook } from "../executors/builtin.js";
import { previewHook } from "../preview.js";
import { git, excludeHookLogs } from "../builtins/git-workflow.js";
import {
  checkpoint,
  duration,
  repeatable,
  validateTargets,
  flowOrderErrors,
} from "./validation.js";
import { Store, Transaction, id, owner, sameHost, alive } from "./store.js";
import {
  takeSnapshot,
  snapshotChanged,
  freezeChoice,
  fillChoice,
  safeFile,
} from "./snapshot.js";
import {
  ControlError,
  now,
  type Action,
  type Chain,
  type CheckpointOptions,
  type Choice,
  type ControlResult,
  type Decision,
  type EventRecord,
  type Execution,
  type Workflow,
} from "./types.js";
import type { HookPayload, HookResult, ResolvedHook } from "../types.js";
import type { RunEventOptions } from "../runner.js";
import {
  publishDecision,
  pollDecision,
  previewPublication,
  notifyReaction,
  withGithubBudget,
} from "./github.js";

const result = (
  status: ControlResult["status"],
  fields: Partial<ControlResult> = {}
): ControlResult => ({
  tracked: true,
  status,
  exitCode: status === "blocked" ? 3 : 0,
  results: [],
  registryIssues: [],
  ...fields,
});
export function controlFailure(error: unknown): ControlResult {
  const e =
    error instanceof ControlError
      ? error
      : new ControlError("operation-failed", (error as Error).message);
  return result("error", {
    exitCode: e.exitCode,
    error: { code: e.code, message: e.message, recovery: e.recovery },
  });
}
/** A manual (untracked) call cannot escape a pause saved by a tracked run by dropping its IDs. */
export async function legacyBarrier(
  opts: RunEventOptions,
  payload: HookPayload
): Promise<ControlResult | undefined> {
  if (payload.phase === "signal") return undefined;
  let store: Store;
  try {
    store = await Store.open(opts.root);
  } catch {
    return undefined;
  }
  if (!(await fs.pathExists(path.join(store.root, "workflows"))))
    return undefined;
  if (await fs.pathExists(path.join(store.root, "intent.json")))
    return controlFailure(
      new ControlError(
        "reconciliation-required",
        "An interrupted state change was saved; inspect it before more work.",
        1,
        "spec-lite next"
      )
    );
  const entries = (await fs.readdir(path.join(store.root, "workflows"))).filter(
    (name) => /^w-[a-z0-9]+\.json$/.test(name)
  );
  const workflows: Workflow[] = [];
  try {
    for (const name of entries)
      workflows.push(
        await fs.readJson(path.join(store.root, "workflows", name))
      );
  } catch {
    return controlFailure(
      new ControlError(
        "runtime-state",
        "Saved runtime state is unreadable; inspect before proceeding.",
        1,
        "spec-lite next"
      )
    );
  }
  let key: string | undefined;
  // Unscoped manual calls cannot name paused work, so unrelated pauses never block them.
  // Durable hooks on such events still need a tracked run and its guard.
  try {
    key = scope(payload, store.workspace).key;
  } catch {
    return undefined;
  }
  if (workflows.some((w) => w.barrier && w.key === key))
    return controlFailure(
      new ControlError(
        "tracked-required",
        "This work is paused in a tracked run. Continue it with the IDs that `spec-lite next` shows.",
        2,
        "spec-lite next"
      )
    );
  return undefined;
}
function context(execution: Execution) {
  return {
    workspace: execution.workspace,
    role: execution.role,
    generation: execution.generation,
    chain: execution.chain,
    parent: execution.parent,
  };
}
function eventResult(
  event: EventRecord,
  execution: Execution,
  status: ControlResult["status"],
  fields: Partial<ControlResult> = {}
): ControlResult {
  return result(status, {
    workflowId: event.workflow,
    executionId: execution.id,
    eventId: event.id,
    context: context(execution),
    payload: event.payload,
    results: event.outcomes,
    effects: event.effects,
    continuation: {
      execution: execution.id,
      event: event.id,
      position: event.position,
      cursor: event.cursor,
      ...(["replaced", "stopped"].includes(event.status)
        ? {
            cancelledSuffix: event.hooks.slice(event.cursor).map((h) => h.name),
          }
        : {}),
    },
    ...fields,
  });
}
export function startCommand(action: Action): string {
  if (action.target?.completion === "lifecycle")
    return `spec-lite hook run ${action.target.logical}.pre --tracked --action ${action.id}`;
  return `spec-lite action start ${action.id}${action.choice.continue || action.choice.stop ? ` --execution ${action.execution}` : ""}`;
}
async function actionResult(
  tx: Transaction,
  action: Action
): Promise<ControlResult> {
  const origin = await tx.require("events", action.event);
  const execution = await tx.require(
    "executions",
    action.owner?.execution ?? action.execution
  );
  return eventResult(
    origin,
    execution,
    action.status === "ready"
      ? "ready"
      : action.status === "failed"
        ? "interrupted"
        : action.status,
    {
      action,
      actionId: action.id,
      decisionId: action.decision,
      startCommand:
        action.status === "ready" ? startCommand(action) : undefined,
    }
  );
}
async function decisionResult(
  tx: Transaction,
  decision: Decision
): Promise<ControlResult> {
  const event = await tx.require("events", decision.event);
  const execution = await tx.require("executions", decision.execution);
  if (decision.status === "answered" && decision.action)
    return {
      ...(await actionResult(tx, await tx.require("actions", decision.action))),
      decision,
    };
  return eventResult(
    event,
    execution,
    decision.status === "answered" ? "paused" : decision.status,
    { decision, decisionId: decision.id, message: decision.publication?.error }
  );
}
/** Payload keys that name a run's work; saved with its execution and never changed by later events. */
const SCOPE_KEYS = [
  "plan",
  "scope",
  "work",
  "name",
  "change",
  "artifact",
  "yolo",
] as const;
function scope(
  payload: HookPayload,
  root: string
): { kind: string; scope: string; key: string } {
  const text = (key: string) =>
    typeof payload[key] === "string" && String(payload[key]).trim()
      ? String(payload[key]).trim()
      : undefined;
  const artifact = (raw: string) => {
    const relative = path
      .relative(root, path.resolve(root, raw))
      .split(path.sep)
      .join("/");
    if (
      !relative ||
      relative.startsWith("../") ||
      path.isAbsolute(relative) ||
      relative.startsWith(".git/")
    )
      throw new ControlError(
        "invalid-scope",
        `Scope ${raw} must resolve within the workspace.`,
        2
      );
    return relative;
  };
  let kind: string;
  let value: string;
  if (text("change")) {
    // A change keeps its own workflow and changeset; joining a feature's would
    // reopen that feature's saved flow and rewrite its changeset.json.
    if (payload.feature?.id)
      throw new ControlError(
        "invalid-scope",
        "Change Mode does not take --feature; pass only --payload change=<name>.",
        2
      );
    kind = "change";
    value = text("change")!;
    if (!isSafeWorkName(value))
      throw new ControlError(
        "invalid-scope",
        `Change name ${value} names a file; use letters, digits, ".", "_" or "-", such as add-json-flag or PROJ-123.`,
        2
      );
  } else if (payload.feature?.id) {
    kind = "feature";
    value = payload.feature.id.toUpperCase();
  } else if (text("plan")) {
    kind = "plan";
    value = artifact(text("plan")!);
  } else if (text("yolo")) {
    kind = "yolo";
    value = text("yolo")!;
  } else if (text("artifact")) {
    kind = payload.role;
    value = artifact(text("artifact")!);
  } else if (text("scope") || text("work")) {
    kind = payload.role === "review" ? "review" : "work";
    value = text("scope") ?? text("work")!;
  } else if (text("name")) {
    kind = payload.role === "review" ? "review" : "fix";
    value = text("name")!;
  } else
    throw new ControlError(
      "scope-required",
      `Resolve work before ${payload.event}: supply --feature or --payload plan=path, scope=key, artifact=path, name=fix-name, change=change-name, or yolo=run-id.`,
      2
    );
  return { kind, scope: value, key: `${kind}:${value.normalize("NFC")}` };
}
function bind(
  payload: HookPayload,
  execution: Execution,
  workflow: Workflow,
  eventId?: string
): void {
  payload.workflow = { id: workflow.id };
  payload.execution = { id: execution.id, generation: execution.generation };
  payload.chain = { id: execution.chain };
  if (execution.action) payload.action = { id: execution.action };
  if (eventId) payload.eventId = eventId;
}
async function guard(
  tx: Transaction,
  workflow: Workflow,
  allowed?: string
): Promise<void> {
  let current: Workflow | undefined = workflow;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id))
      throw new ControlError(
        "invalid-ancestry",
        "Workflow ancestry contains a cycle.",
        2
      );
    visited.add(current.id);
    if (current.barrier && current.barrier !== allowed)
      throw new ControlError(
        "workflow-paused",
        `Workflow ${current.id} is paused at ${current.barrier}.`,
        1,
        "spec-lite next"
      );
    current = current.parent
      ? await tx.require("workflows", current.parent)
      : undefined;
  }
}
async function checkSnapshot(
  tx: Transaction,
  action: Action | Decision
): Promise<ControlResult | undefined> {
  const changed = await snapshotChanged(action.snapshot);
  if (!changed) return undefined;
  if ("choices" in action) {
    if (action.status === "pending") action.status = "superseded";
    if (action.action) {
      const saved = await tx.require("actions", action.action);
      if (saved.status === "ready") {
        saved.status = "superseded";
        tx.put("actions", saved);
      }
    }
    action.reason = changed;
    tx.put("decisions", action);
    return {
      ...(await decisionResult(tx, action)),
      exitCode: 1,
      error: {
        code: "snapshot-changed",
        message: changed,
        recovery: `spec-lite decision reissue ${action.id} --reason <user-instruction>`,
      },
    };
  }
  if (action.status === "ready") action.status = "superseded";
  const event = await tx.require("events", action.event);
  if (!action.decision) {
    event.status = "paused";
    event.result = undefined;
    tx.put("events", event);
  }
  tx.put("actions", action);
  return {
    ...(await actionResult(tx, action)),
    exitCode: 1,
    error: {
      code: "snapshot-changed",
      message: changed,
      recovery: action.decision
        ? `spec-lite decision reissue ${action.decision} --reason <user-instruction>`
        : `spec-lite hook recover ${action.event} --generation ${event.generation} --mode stop --reason <user-instruction>`,
    },
  };
}
function occurrence(payload: HookPayload): string {
  return `${payload.event}:${payload.task?.id ?? payload.feature?.id ?? "root"}`;
}
async function finish(
  tx: Transaction,
  event: EventRecord,
  execution: Execution
): Promise<void> {
  event.status = "completed";
  const boundary =
    event.name === `${execution.role}.post` ||
    (execution.role === "review" && event.name === "review.verdict");
  if (boundary) {
    execution.status = "completed";
    execution.bodyProduced = true;
    if (execution.action) {
      const action = await tx.require("actions", execution.action);
      if (
        (action.status !== "running" &&
          !(
            event.name === "review.verdict" && action.status === "completed"
          )) ||
        action.owner?.execution !== execution.id ||
        action.owner.generation !== execution.generation
      )
        throw new ControlError(
          "stale-owner",
          "Completion does not match the current owner/generation."
        );
      action.status = "completed";
      action.outcome = "success";
      tx.put("actions", action);
    }
  }
  const workflow = await tx.require("workflows", event.workflow);
  if (workflow.barrier === event.id) workflow.barrier = undefined;
  tx.put("workflows", workflow);
  tx.put("executions", execution);
}
async function expire(tx: Transaction, decision: Decision): Promise<void> {
  if (
    decision.status === "pending" &&
    Date.now() >= Date.parse(decision.expiresAt)
  ) {
    decision.status = "expired";
    tx.put("decisions", decision);
  }
}
function newChain(max = 8): Chain {
  return { id: id("c"), hops: 0, routes: [], checkpointRoutes: [], max };
}
async function accept(
  tx: Transaction,
  decision: Decision,
  choiceId: string,
  answer: {
    actor: string;
    source: "local-session" | "github" | "rule";
    feedback: string;
    remote?: unknown;
    rule?: unknown;
  }
): Promise<ControlResult> {
  await expire(tx, decision);
  if (decision.status !== "pending") {
    if (
      decision.status === "answered" &&
      decision.answer?.choice === choiceId &&
      decision.answer.actor === answer.actor &&
      decision.answer.source === answer.source &&
      decision.answer.feedback === answer.feedback
    )
      return decisionResult(tx, decision);
    return {
      ...(await decisionResult(tx, decision)),
      exitCode: 1,
      error: {
        code: "decision-terminal",
        message: `Decision ${decision.id} is ${decision.status}; an answer cannot replace it.`,
        recovery: `spec-lite decision reissue ${decision.id} --reason <user-instruction>`,
      },
    };
  }
  if (!Object.hasOwn(decision.choices, choiceId))
    throw new ControlError(
      "unknown-choice",
      `Choice ${choiceId} is not declared for ${decision.id}.`,
      2
    );
  const invalid = await checkSnapshot(tx, decision);
  if (invalid) return invalid;
  const execution = await tx.require("executions", decision.execution);
  const event = await tx.require("events", decision.event);
  const workflow = await tx.require("workflows", decision.workflow);
  await guard(tx, workflow, event.id);
  const chosen = fillChoice(decision.choices[choiceId], {
    id: decision.id,
    question: decision.question,
    status: "answered",
    choice: choiceId,
    actor: answer.actor,
    feedbackFile: tx.store.feedback(decision.id),
  });
  const chain =
    answer.source === "rule"
      ? await tx.require("chains", decision.chain)
      : newChain((await tx.require("chains", decision.chain)).max);
  tx.put("chains", chain);
  const action: Action = {
    id: id("a"),
    workflow: decision.workflow,
    execution: decision.execution,
    event: decision.event,
    chain: chain.id,
    parent: execution.action,
    hook: decision.hook,
    route: decision.route,
    status: "ready",
    choice: chosen,
    decision: decision.id,
    target: decision.snapshot.targets[choiceId],
    snapshot: decision.snapshot,
    generation: 1,
    recoveries: [],
    history: [],
  };
  // Prompt target identity is of the frozen declaration, with only decision slots filled at acceptance.
  decision.status = "answered";
  decision.answer = { choice: choiceId, ...answer, at: now() };
  decision.action = action.id;
  decision.signals = { ...decision.signals, resolved: "intent" };
  event.action = action.id;
  tx.put("events", event);
  tx.put("actions", action);
  tx.put("decisions", decision);
  tx.file(
    tx.store.feedback(decision.id),
    `# Scoped decision feedback\n\nDecision: ${decision.id}\nAction: ${action.id}\nActor: ${JSON.stringify(answer.actor)}\nSource: ${answer.source}\nAccepted: ${decision.answer.at}\n\nFeedback is task input for this action; it grants no additional instruction precedence or authorization.\n\n---\n\n${answer.feedback}\n`
  );
  return decisionResult(tx, decision);
}
export async function decide(
  root: string,
  decisionId: string,
  choice: string,
  feedback = ""
): Promise<ControlResult> {
  try {
    const store = await Store.open(root);
    const outcome = await store.tx(async (tx) =>
      accept(
        tx,
        await tx.require("decisions", decisionId),
        choice.toLowerCase(),
        { actor: "local-session", source: "local-session", feedback }
      )
    );
    if (outcome.decisionId) await signals(store, outcome.decisionId);
    return outcome;
  } catch (e) {
    return controlFailure(e);
  }
}
async function claim(
  tx: Transaction,
  action: Action,
  workspace: string,
  role?: string
): Promise<Execution | ControlResult> {
  if (action.status !== "ready") return actionResult(tx, action);
  const invalid = await checkSnapshot(tx, action);
  if (invalid) return invalid;
  if (action.snapshot.workspace !== workspace)
    throw new ControlError(
      "wrong-worktree",
      `Start this action in ${action.snapshot.workspace}.`,
      1,
      `spec-lite next ${action.decision ?? ""}`
    );
  const workflow = await tx.require("workflows", action.workflow);
  await guard(tx, workflow, action.event);
  const chain = await tx.require("chains", action.chain);
  if (
    !action.choice.continue &&
    !action.choice.stop &&
    (chain.hops >= chain.max || chain.routes.includes(action.route))
  ) {
    const event = await tx.require("events", action.event);
    event.status = "paused";
    tx.put("events", event);
    return eventResult(
      event,
      await tx.require("executions", action.execution),
      "paused",
      {
        actionId: action.id,
        message:
          "Automatic routing repeated or exhausted its chain; a user must request recovery.",
        retryAllowed: false,
      }
    );
  }
  if (
    role &&
    (action.target?.completion !== "lifecycle" ||
      action.target.logical !== role)
  )
    throw new ControlError(
      "wrong-target",
      `Action ${action.id} must start through ${startCommand(action)}.`,
      2
    );
  if (!role && action.target?.completion === "lifecycle")
    throw new ControlError(
      "instrumented-start",
      `Use ${startCommand(action)}.`,
      2
    );
  const origin = await tx.require("executions", action.execution);
  const event = await tx.require("events", action.event);
  action.status = "running";
  const execution: Execution = {
    id: id("x"),
    workflow: action.workflow,
    role: role ?? action.target?.logical ?? "control",
    workspace,
    parent: origin.parent,
    action: action.id,
    chain: action.chain,
    generation: action.generation,
    status: "running",
    createdAt: now(),
    payload: structuredClone(origin.payload),
    events: {},
  };
  action.owner = { execution: execution.id, generation: action.generation };
  if (!action.choice.continue && !action.choice.stop) {
    chain.hops++;
    chain.routes.push(action.route);
    tx.put("chains", chain);
    event.status = "replaced";
    origin.status = "replaced";
    origin.bodyProduced = event.position === "after-body";
    if (origin.action) {
      const owning = await tx.require("actions", origin.action);
      if (owning.owner?.execution === origin.id) {
        owning.status =
          event.position === "after-body" ? "completed" : "stopped";
        owning.outcome = "replaced";
        tx.put("actions", owning);
      }
    }
    workflow.barrier = undefined;
    tx.put("events", event);
    tx.put("executions", origin);
    tx.put("workflows", workflow);
  }
  tx.put("actions", action);
  tx.put("executions", execution);
  return execution;
}
export async function startAction(
  root: string,
  actionId: string,
  originId?: string
): Promise<ControlResult> {
  try {
    const store = await Store.open(root);
    let resume: string | undefined;
    const outcome = await store.tx(async (tx) => {
      const action = await tx.require("actions", actionId);
      if (
        (action.choice.continue || action.choice.stop) &&
        originId !== action.execution
      )
        throw new ControlError(
          "origin-required",
          `Pass --execution ${action.execution} to acknowledge this continuation.`,
          2
        );
      const claimed = await claim(tx, action, store.workspace);
      if ("tracked" in claimed) return claimed;
      const current = await tx.require("actions", action.id);
      const event = await tx.require("events", action.event);
      const origin = await tx.require("executions", action.execution);
      if (action.choice.stop) {
        current.status = "stopped";
        current.outcome = "stopped";
        event.status = "stopped";
        origin.status = "stopped";
        origin.bodyProduced = event.position === "after-body";
        claimed.status = "stopped";
        const workflow = await tx.require("workflows", event.workflow);
        workflow.barrier = undefined;
        tx.put("workflows", workflow);
        if (origin.action) {
          const a = await tx.require("actions", origin.action);
          a.status = "stopped";
          a.outcome = "stopped";
          tx.put("actions", a);
        }
        tx.put("actions", current);
        tx.put("events", event);
        tx.put("executions", origin);
        tx.put("executions", claimed);
        return eventResult(event, origin, "stopped", {
          actionId: current.id,
          action: current,
        });
      }
      if (action.choice.continue) {
        current.status = "completed";
        current.outcome = "success";
        claimed.status = "completed";
        event.status = "running";
        event.decision = undefined;
        event.action = undefined;
        const workflow = await tx.require("workflows", event.workflow);
        workflow.barrier = undefined;
        tx.put("workflows", workflow);
        tx.put("actions", current);
        tx.put("executions", claimed);
        tx.put("events", event);
        resume = event.id;
        return eventResult(event, origin, "running");
      }
      return result("started", {
        workflowId: action.workflow,
        executionId: claimed.id,
        actionId: action.id,
        context: context(claimed),
        action: current,
        message:
          "Completion is reported; acknowledge with action complete after invocation.",
      });
    });
    return resume ? await dispatchEvent(store, resume) : outcome;
  } catch (e) {
    return controlFailure(e);
  }
}
export async function completeAction(
  root: string,
  actionId: string,
  executionId: string,
  outcome: string
): Promise<ControlResult> {
  try {
    if (!["success", "failed", "stopped"].includes(outcome))
      throw new ControlError(
        "invalid-outcome",
        "Outcome must be success, failed or stopped.",
        2
      );
    const store = await Store.open(root);
    return await store.tx(async (tx) => {
      const action = await tx.require("actions", actionId);
      if (action.target?.completion !== "reported")
        throw new ControlError(
          "lifecycle-completion",
          "Instrumented targets complete at their lifecycle boundary.",
          2
        );
      const execution = await tx.require("executions", executionId);
      if (
        action.owner?.execution !== execution.id ||
        action.owner.generation !== action.generation ||
        execution.generation !== action.generation
      )
        throw new ControlError(
          "stale-owner",
          "The execution/generation does not own this action."
        );
      if (action.status !== "running") {
        if (action.outcome === outcome) return actionResult(tx, action);
        throw new ControlError(
          "invalid-transition",
          `Cannot complete ${action.status} action.`
        );
      }
      action.outcome = outcome;
      action.status =
        outcome === "success"
          ? "completed"
          : outcome === "stopped"
            ? "stopped"
            : "failed";
      execution.status =
        outcome === "success"
          ? "completed"
          : outcome === "stopped"
            ? "stopped"
            : "interrupted";
      const workflow = await tx.require("workflows", action.workflow);
      workflow.barrier = outcome === "failed" ? action.event : undefined;
      tx.put("workflows", workflow);
      tx.put("actions", action);
      tx.put("executions", execution);
      return actionResult(tx, action);
    });
  } catch (e) {
    return controlFailure(e);
  }
}

export async function runControlledEvent(
  opts: RunEventOptions,
  payload: HookPayload,
  hooks: ResolvedHook[]
): Promise<ControlResult> {
  try {
    // A dry run saves nothing, so a manual preview may include gates and checkpoints.
    if (!opts.tracked && !opts.dryRun)
      throw new ControlError(
        "tracked-required",
        "A gate, checkpoint or hand-off hook subscribes to this event. They only work in a tracked role run (--tracked); let the role fire the event, or skip those hooks with --skip <name>.",
        2
      );
    if (!getEvent(opts.event))
      throw new ControlError(
        "unknown-event",
        `Unknown event ${opts.event}.`,
        2
      );
    const ordering = flowOrderErrors(hooks);
    if (ordering.length)
      throw new ControlError("routing-order", ordering.join("\n"), 2);
    const verdictCodes: Record<string, string[]> = {
      "plan-critic.post": ["ready", "revisions", "replan"],
      "review.post": ["pass", "changes-required", "blocked"],
      "review.verdict": ["pass", "changes-required", "blocked"],
    };
    if (
      verdictCodes[opts.event] &&
      !verdictCodes[opts.event].includes(String(payload.verdictCode))
    )
      throw new ControlError(
        "verdict-code",
        `${opts.event} requires verdictCode=${verdictCodes[opts.event].join("|")}; prose is not a stable verdict.`,
        2
      );
    for (const hook of hooks) {
      const choices = checkpoint(hook)
        ? (hook.options as unknown as CheckpointOptions).choices
        : ["skill", "agent", "prompt"].includes(hook.type)
          ? { static: staticChoice(hook) }
          : {};
      const errors = await validateTargets(choices);
      if (errors.length)
        throw new ControlError("target-contract", errors.join("\n"), 2);
    }
    const store = await Store.open(opts.root);
    payload.cwd = store.workspace;
    if (opts.dryRun) {
      if (!opts.execution && !opts.action) scope(payload, store.workspace);
      const results: HookResult[] = [];
      for (const hook of hooks) {
        let preview = previewHook(hook, { payload });
        if (checkpoint(hook))
          preview = JSON.stringify(
            await previewPublication(store, hook, payload)
          );
        results.push({
          name: hook.name,
          event: payload.event,
          kind: hook.type,
          status: "skipped",
          durationMs: 0,
          message: "dry run — no state, worktree, files or remote changes",
          preview,
        });
      }
      return result("continue", {
        payload,
        results,
        message: "Dry run only; no continuation is authorized.",
      });
    }
    if (!opts.execution && !opts.action) await maybePrune(store);
    const maxChain = (await readProjectConfig(opts.root)).hooks?.maxChain ?? 8;
    if (!Number.isInteger(maxChain) || maxChain < 1 || maxChain > 100)
      throw new ControlError(
        "chain-config",
        "hooks.maxChain must be an integer from 1 to 100.",
        2
      );
    const prepared = await store.tx(
      async (tx): Promise<string | ControlResult> => {
        let execution: Execution;
        let workflow: Workflow;
        let started = false;
        if (opts.action && !opts.execution) {
          if (payload.event !== `${payload.role}.pre`)
            throw new ControlError(
              "start-boundary",
              "An action starts at its target's root pre event.",
              2
            );
          const action = await tx.require("actions", opts.action);
          const claimed = await claim(
            tx,
            action,
            store.workspace,
            payload.role
          );
          if ("tracked" in claimed) return claimed;
          execution = claimed;
          started = true;
          workflow = await tx.require("workflows", execution.workflow);
          // Scope and arguments come from saved approval; explicit caller values cannot replace it.
          const saved = structuredClone(execution.payload);
          for (const key of SCOPE_KEYS)
            if (saved[key] !== undefined) payload[key] = saved[key];
          if (saved.feature) payload.feature = saved.feature;
          payload.selectedAction = action.choice;
        } else if (opts.execution) {
          execution = await tx.require("executions", opts.execution);
          workflow = await tx.require("workflows", execution.workflow);
          if (execution.workspace !== store.workspace)
            throw new ControlError(
              "wrong-worktree",
              `Execution belongs in ${execution.workspace}.`
            );
          if (
            opts.action !== execution.action &&
            (opts.action || execution.action)
          )
            throw new ControlError(
              "action-context",
              `Execution requires --action ${execution.action ?? "(none)"}.`,
              2
            );
          if (
            execution.role !== payload.role &&
            !(
              execution.role === "plan-feature" &&
              payload.event === "feature.spec.post"
            )
          )
            throw new ControlError(
              "role-context",
              `Execution belongs to ${execution.role}.`,
              2
            );
          if (execution.action) {
            const action = await tx.require("actions", execution.action);
            if (
              (action.status !== "running" &&
                !(
                  payload.event === "review.verdict" &&
                  execution.status === "completed" &&
                  action.status === "completed"
                )) ||
              action.owner?.execution !== execution.id ||
              action.generation !== execution.generation
            )
              throw new ControlError(
                "stale-owner",
                "Execution is not the current active owner."
              );
          }
          if (!["running", "completed"].includes(execution.status))
            throw new ControlError(
              "execution-terminal",
              `Execution is ${execution.status}.`,
              1,
              "spec-lite next"
            );
          // Review's trailing verdict may follow its completed post only while no replacement/barrier exists.
          if (
            execution.status === "completed" &&
            payload.event !== "review.verdict"
          ) {
            const existing = execution.events[occurrence(payload)];
            if (existing)
              return (
                (await tx.require("events", existing)).result ??
                eventResult(
                  await tx.require("events", existing),
                  execution,
                  "completed"
                )
              );
            throw new ControlError(
              "execution-completed",
              "Execution is complete; start a new acknowledged execution."
            );
          }
          const savedScope = scope(execution.payload, execution.workspace);
          if (
            opts.featureId &&
            !["feature", "plan-feature"].includes(execution.role)
          ) {
            const merged = {
              ...execution.payload,
              ...payload,
              feature: payload.feature ?? execution.payload.feature,
            };
            if (scope(merged, execution.workspace).key !== savedScope.key)
              throw new ControlError(
                "scope-mismatch",
                "Event cannot change its execution's saved scope.",
                2
              );
          }
          for (const key of SCOPE_KEYS)
            if (
              opts.extra?.[key] !== undefined &&
              execution.payload[key] !== undefined
            ) {
              const normalized = (value: unknown) =>
                ["plan", "artifact"].includes(key)
                  ? path.resolve(execution.workspace, String(value))
                  : String(value);
              if (
                normalized(opts.extra[key]) !==
                normalized(execution.payload[key])
              )
                throw new ControlError(
                  "scope-mismatch",
                  `Event cannot change saved ${key}.`,
                  2
                );
            }
          for (const key of SCOPE_KEYS)
            if (payload[key] === undefined)
              payload[key] = execution.payload[key];
          if (
            payload.event === "review.verdict" &&
            payload.report === undefined
          )
            payload.report = execution.payload.report;
          payload.feature ??= execution.payload.feature;
        } else {
          if (payload.event !== `${payload.role}.pre`)
            throw new ControlError(
              "execution-required",
              `Start ${payload.role}.pre with scope, then carry its --execution ID through all events.`,
              2
            );
          const identity = scope(payload, store.workspace);
          const parentId =
            opts.parent ?? (String(payload.parentExecution ?? "") || undefined);
          const parent = parentId
            ? await tx.require("executions", parentId)
            : undefined;
          if (parent && parent.status !== "running")
            throw new ControlError(
              "parent-terminal",
              "New children require an active parent execution."
            );
          if (parent)
            await guard(tx, await tx.require("workflows", parent.workflow));
          const existing = (await tx.list("workflows")).find(
            (w) => w.key === identity.key
          );
          workflow = existing ?? {
            id: id("w"),
            ...identity,
            workspace: store.workspace,
            parent: parent?.workflow,
            createdAt: now(),
          };
          if (workflow.parent === workflow.id) workflow.parent = undefined;
          if (workflow.barrier)
            throw new ControlError(
              "workflow-paused",
              `Workflow ${workflow.id} is paused at ${workflow.barrier}.`,
              1,
              "spec-lite next"
            );
          const active = (await tx.list("executions")).find(
            (e) =>
              e.workflow === workflow.id &&
              e.status === "running" &&
              e.id !== parent?.id
          );
          if (
            active &&
            (!parent || active.role === payload.role || active.action)
          )
            throw new ControlError(
              "execution-active",
              `Scope already belongs to running execution ${active.id} (${active.role}, started ${active.createdAt}).`,
              1,
              recoverCommand(active)
            );
          if (workflow.workspace !== store.workspace && active)
            throw new ControlError(
              "wrong-worktree",
              `Scope is active in ${workflow.workspace}.`
            );
          // Reused scopes bind to this execution's controller after prior owners end.
          if (!active && parent?.workflow !== workflow.id)
            workflow.parent = parent?.workflow;
          await guard(tx, workflow);
          if (!workflow.sourceRemote)
            workflow.sourceRemote = await git(store.workspace, [
              "remote",
              "get-url",
              "origin",
            ]).catch(() => undefined);
          const chain = parent
            ? await tx.require("chains", parent.chain)
            : newChain(maxChain);
          tx.put("chains", chain);
          execution = {
            id: id("x"),
            workflow: workflow.id,
            role: payload.role,
            workspace: store.workspace,
            parent: parent?.id,
            chain: chain.id,
            generation: 1,
            status: "running",
            createdAt: now(),
            payload: structuredClone(payload),
            events: {},
          };
          tx.put("workflows", workflow);
          tx.put("executions", execution);
        }
        if (
          ["plan", "plan-critic"].includes(payload.role) &&
          (typeof payload.plan !== "string" || !payload.plan.trim())
        )
          throw new ControlError(
            "plan-required",
            `${payload.event} requires the intended source plan path.`,
            2
          );
        if (
          ["plan-critic.post", "review.post", "review.verdict"].includes(
            payload.event
          )
        ) {
          if (
            typeof payload.report !== "string" ||
            !payload.report.trim() ||
            typeof payload.verdict !== "string" ||
            !payload.verdict.trim()
          )
            throw new ControlError(
              "report-contract",
              `${payload.event} requires report=<path>, display verdict, and a stable verdictCode.`,
              2
            );
          if ((await safeFile(execution.workspace, payload.report)).missing)
            throw new ControlError(
              "missing-report",
              `Write report ${payload.report} before ${payload.event}.`,
              2
            );
        }
        if (
          payload.event === "plan.post" ||
          payload.event === "plan-critic.pre"
        )
          if (
            (await safeFile(execution.workspace, String(payload.plan))).missing
          )
            throw new ControlError(
              "missing-plan",
              `Plan ${payload.plan} must exist before ${payload.event}.`,
              2
            );
        const key = occurrence(payload);
        const existingId = execution.events[key];
        if (existingId) {
          const event = await tx.require("events", existingId);
          if (opts.retry) {
            if (opts.retry !== event.id)
              throw new ControlError(
                "retry-id",
                `Retry must name saved event ${event.id}.`,
                2
              );
            if (event.status !== "blocked")
              throw new ControlError(
                "retry-state",
                `Event is ${event.status}; retry is only for a blocked gate.`,
                2
              );
            if (event.rounds >= event.maxRounds)
              return eventResult(event, execution, "blocked", {
                retryAllowed: false,
                message:
                  "Total check round budget exhausted; request explicit recovery.",
                recovery: eventRecovery(event),
              });
            await guard(tx, workflow, event.id);
            event.status = "running";
            event.rounds++;
            event.cursor = event.hooks.findIndex((h) => h.gate);
            event.inFlight = undefined;
            tx.put("events", event);
            return event.id;
          }
          if (event.inFlight) {
            if (!sameHost(event.inFlight.host) || alive(event.inFlight.pid))
              return eventResult(event, execution, "running", {
                message:
                  "Hook attempt has an owner; inspect without replaying it.",
              });
            if (!event.inFlight.repeatable) {
              event.status = "interrupted";
              tx.put("events", event);
              workflow.barrier = event.id;
              tx.put("workflows", workflow);
              return eventResult(event, execution, "interrupted", {
                message: `Effect ${event.inFlight.hook} is uncertain; reconcile with hook recover.`,
                retryAllowed: false,
              });
            }
            event.inFlight = undefined;
            tx.put("events", event);
            return event.id;
          }
          if (event.decision) {
            const d = await tx.require("decisions", event.decision);
            await expire(tx, d);
            return decisionResult(tx, d);
          }
          if (event.action)
            return actionResult(tx, await tx.require("actions", event.action));
          if (event.status === "completed" && event.position === "before-body")
            return eventResult(event, execution, "running", {
              message:
                "Pre boundary was already acknowledged; do not rerun its body.",
            });
          return (
            event.result ??
            eventResult(
              event,
              execution,
              event.status === "completed"
                ? "continue"
                : event.status === "replaced"
                  ? "stopped"
                  : event.status,
              {
                retryAllowed:
                  event.status === "blocked" && event.rounds < event.maxRounds,
              }
            )
          );
        }
        if (opts.retry)
          throw new ControlError(
            "retry-id",
            "Retry cannot allocate a new event occurrence.",
            2
          );
        await guard(tx, workflow);
        // Parents may not checkpoint over children still running.
        if (
          hooks.some(checkpoint) &&
          (await tx.list("executions")).some(
            (e) => e.parent === execution.id && e.status === "running"
          )
        )
          throw new ControlError(
            "children-active",
            "Checkpoint requires active children to reach their boundary first."
          );
        const event: EventRecord = {
          id: id("e"),
          workflow: workflow.id,
          execution: execution.id,
          chain: execution.chain,
          name: payload.event,
          key,
          generation: 1,
          status: "running",
          position:
            payload.phase === "pre"
              ? "before-body"
              : payload.phase === "post"
                ? "after-body"
                : "signal",
          cursor: 0,
          hooks: structuredClone(hooks),
          payload: structuredClone(payload),
          rounds: hooks.some((h) => h.gate) ? 1 : 0,
          maxRounds: Math.min(
            3,
            ...hooks.filter((h) => h.gate).map((h) => h.maxRounds ?? 3)
          ),
          episode: 1,
          effects: [],
          outcomes: [],
          overrides: [],
          recoveries: [],
        };
        if (hooks.some((h) => h.gate))
          event.maxRounds = Math.min(
            ...hooks.filter((h) => h.gate).map((h) => h.maxRounds ?? 3)
          );
        bind(event.payload, execution, workflow, event.id);
        execution.payload = structuredClone(event.payload);
        execution.events[key] = event.id;
        if (started)
          payload.selectedAction = (
            await tx.require("actions", opts.action!)
          ).choice;
        tx.put("events", event);
        tx.put("executions", execution);
        return event.id;
      }
    );
    return typeof prepared === "string"
      ? await dispatchEvent(store, prepared, !!opts.retry)
      : prepared;
  } catch (e) {
    return controlFailure(e);
  }
}
function staticChoice(hook: ResolvedHook): Choice {
  return {
    description: hook.description ?? hook.name,
    ...(hook.skill
      ? { skill: hook.skill }
      : hook.agent
        ? { agent: hook.agent }
        : { prompt: hook.prompt! }),
    args: hook.args,
    completion: hook.completion,
  };
}
async function dispatchEvent(
  store: Store,
  eventId: string,
  retry = false
): Promise<ControlResult> {
  if (retry) {
    const event = await store.tx((tx) => tx.require("events", eventId));
    for (const hook of event.hooks.filter(
      (h) =>
        repeatable(h) &&
        (h.builtin ?? h.name) !== "prepare-worktree" &&
        !missingRequirements(h.requires, { payload: event.payload }).length
    )) {
      const outcome = await invoke(store, hook, event.payload);
      if (outcome.status === "failed")
        return failEvent(
          store,
          eventId,
          outcome,
          hook.gate ? "blocked" : "interrupted"
        );
    }
  }
  for (;;) {
    const next = await store.tx(
      async (
        tx
      ): Promise<
        { event: EventRecord; hook: ResolvedHook } | ControlResult
      > => {
        const event = await tx.require("events", eventId);
        const execution = await tx.require("executions", event.execution);
        if (event.status !== "running")
          return (
            event.result ??
            eventResult(
              event,
              execution,
              event.status === "completed"
                ? "continue"
                : event.status === "replaced"
                  ? "stopped"
                  : event.status
            )
          );
        const hook = event.hooks[event.cursor];
        if (!hook) {
          await finish(tx, event, execution);
          let final = eventResult(event, execution, "continue");
          if (event.action) {
            const a = await tx.require("actions", event.action);
            const w = await tx.require("workflows", event.workflow);
            w.barrier = event.id;
            tx.put("workflows", w);
            final = await actionResult(tx, a);
          }
          event.result = final;
          tx.put("events", event);
          return final;
        }
        if (event.inFlight)
          return eventResult(event, execution, "running", {
            message: "Another invocation owns this hook attempt.",
          });
        const missing = missingRequirements(hook.requires, {
          payload: event.payload,
        });
        if (missing.length) {
          event.outcomes.push({
            name: hook.name,
            event: event.name,
            kind: hook.type,
            status: "skipped",
            durationMs: 0,
            message: requirementsMessage(missing),
          });
          event.cursor++;
          tx.put("events", event);
          return { event, hook: { ...hook, enabled: false } };
        }
        if (hook.once) {
          const previous = (await tx.list("events")).some(
            (saved) =>
              saved.workflow === event.workflow &&
              saved.outcomes.some(
                (o) =>
                  o.name === hook.name &&
                  o.event === event.name &&
                  (o.status === "ok" || o.status === "emitted")
              )
          );
          if (previous) {
            const skipped: HookResult = {
              name: hook.name,
              event: event.name,
              kind: hook.type,
              status: "skipped",
              durationMs: 0,
              message: "already ran once for this event",
            };
            event.outcomes.push(skipped);
            event.cursor++;
            tx.put("events", event);
            return { event, hook: { ...hook, once: false, enabled: false } };
          }
        }
        event.inFlight = {
          hook: hook.name,
          repeatable:
            repeatable(hook) ||
            !!hook.gate ||
            checkpoint(hook) ||
            ["skill", "agent", "prompt"].includes(hook.type),
          ...owner(),
        };
        tx.put("events", event);
        return { event, hook };
      }
    );
    if ("tracked" in next) return next;
    const { event, hook } = next;
    if (hook.enabled === false) continue;
    if (checkpoint(hook)) {
      const outcome = await createCheckpoint(store, event, hook);
      if (outcome.decisionId) {
        await publishDecision(store, outcome.decisionId);
        await signals(store, outcome.decisionId);
        return store.tx(async (tx) =>
          decisionResult(tx, await tx.require("decisions", outcome.decisionId!))
        );
      }
      return outcome;
    }
    if (["skill", "agent", "prompt"].includes(hook.type)) {
      try {
        const choice = freezeChoice(staticChoice(hook), event.payload);
        const snapshot = await takeSnapshot(
          event.payload.cwd,
          hook,
          event.payload,
          { static: choice }
        );
        const prepared = await store.tx(async (tx) => {
          const current = await tx.require("events", event.id);
          const execution = await tx.require("executions", current.execution);
          const chain = await tx.require("chains", current.chain);
          const route = `${current.workflow}:${current.name}:${hook.name}`;
          if (chain.routes.includes(route) || chain.hops >= chain.max) {
            current.status = "paused";
            current.inFlight = undefined;
            const workflow = await tx.require("workflows", current.workflow);
            workflow.barrier = current.id;
            tx.put("workflows", workflow);
            tx.put("events", current);
            return eventResult(current, execution, "paused", {
              message:
                "Automatic route repeated or exhausted; ask the user for explicit recovery.",
              retryAllowed: false,
            });
          }
          const action: Action = {
            id: id("a"),
            workflow: current.workflow,
            execution: execution.id,
            event: current.id,
            chain: current.chain,
            parent: execution.action,
            hook: hook.name,
            route,
            status: "ready",
            choice,
            target: snapshot.targets.static,
            snapshot,
            generation: 1,
            recoveries: [],
            history: [],
          };
          current.action = action.id;
          current.cursor++;
          current.inFlight = undefined;
          tx.put("actions", action);
          tx.put("events", current);
          return undefined;
        });
        if (prepared) return prepared;
      } catch (e) {
        return failEvent(
          store,
          event.id,
          {
            name: hook.name,
            event: event.name,
            kind: hook.type,
            status: "failed",
            durationMs: 0,
            contractError: true,
            message: (e as Error).message,
          },
          "interrupted"
        );
      }
      continue;
    }
    const outcome = event.overrides.includes(hook.name)
      ? {
          name: hook.name,
          event: event.name,
          kind: hook.type,
          status: "skipped" as const,
          durationMs: 0,
          message: "Explicitly overridden; not a passed check.",
        }
      : await invoke(store, hook, event.payload);
    await audit(store, event.payload, outcome);
    if (
      outcome.status === "failed" &&
      (hook.gate || hook.onFailure === "abort" || outcome.contractError)
    )
      return failEvent(
        store,
        event.id,
        outcome,
        hook.gate && outcome.exitCode === 3 ? "blocked" : "interrupted"
      );
    await store.tx(async (tx) => {
      const current = await tx.require("events", event.id);
      if (
        current.generation !== event.generation ||
        current.inFlight?.pid !== process.pid
      )
        throw new ControlError(
          "stale-event",
          "Event owner generation changed during its hook."
        );
      current.outcomes.push(outcome);
      current.cursor++;
      current.inFlight = undefined;
      if (!repeatable(hook) && !hook.gate)
        current.effects.push({ hook: hook.name, status: outcome.status });
      if (outcome.worktree && outcome.status === "ok") {
        const workspace = await fs.realpath(outcome.worktree.path);
        current.payload.cwd = workspace;
        current.payload.worktree = outcome.worktree;
        const execution = await tx.require("executions", current.execution);
        execution.workspace = workspace;
        execution.payload = current.payload;
        tx.put("executions", execution);
        const workflow = await tx.require("workflows", current.workflow);
        workflow.workspace = workspace;
        tx.put("workflows", workflow);
      }
      await refreshChanges(current.payload.cwd, current.payload);
      tx.put("events", current);
    });
  }
}
async function invoke(
  store: Store,
  hook: ResolvedHook,
  payload: HookPayload
): Promise<HookResult> {
  const validation = validatePayloadForHook(hook, payload);
  if (!validation.ok)
    return {
      name: hook.name,
      event: payload.event,
      kind: hook.type,
      status: "failed",
      durationMs: 0,
      contractError: true,
      message: validation.message,
    };
  const file = await store.temp("payload.json");
  const response = hook.gate ? await store.temp("response.json") : undefined;
  await fs.writeJson(file, payload, { mode: 0o600 });
  try {
    const env = {
      SPEC_LITE_HOOK_DEPTH: String(
        (Number(process.env.SPEC_LITE_HOOK_DEPTH) || 0) + 1
      ),
      SPEC_LITE_RESPONSE_FILE: response ?? "",
      SPEC_LITE_EXECUTION_ID: String(
        (payload.execution as { id: string })?.id ?? ""
      ),
    };
    const ctx = { payload, payloadFile: file };
    let outcome: HookResult;
    try {
      outcome =
        hook.type === "builtin"
          ? await runBuiltinHook(hook, ctx, payload.cwd, env)
          : hook.type === "http"
            ? await runHttpHook(hook, ctx)
            : await runShellHook(hook, ctx, payload.cwd, env);
    } catch (e) {
      outcome = {
        name: hook.name,
        event: payload.event,
        kind: hook.type,
        status: "failed",
        durationMs: 0,
        message: (e as Error).message,
      };
    }
    if (hook.gate && outcome.status === "ok") {
      try {
        const stat = await fs.stat(response!);
        if (!stat.isFile() || stat.size === 0 || stat.size > 65536)
          throw new Error("Gate response must contain 1–65536 bytes.");
        const gate = JSON.parse(
          (await fs.readFile(response!, "utf8")).replace(/^\uFEFF/, "")
        );
        if (
          !gate ||
          typeof gate !== "object" ||
          Array.isArray(gate) ||
          Object.keys(gate).some((k) => !["decision", "reason"].includes(k)) ||
          !["continue", "block"].includes(gate.decision) ||
          (gate.reason !== undefined && typeof gate.reason !== "string")
        )
          throw new Error(
            "Gate response must be exactly {decision: continue|block, reason?: string}."
          );
        if (gate.decision === "block")
          return {
            ...outcome,
            status: "failed",
            exitCode: 3,
            message: gate.reason ?? "Gate explicitly blocked.",
          };
        return { ...outcome, message: "Gate passed." };
      } catch (e) {
        return {
          ...outcome,
          status: "failed",
          exitCode: 1,
          message: `Gate failed closed: ${(e as Error).message}`,
        };
      }
    }
    // Protocol logs/results contain diagnostics only; shell output cannot forge final control records.
    return outcome;
  } finally {
    await fs.remove(file);
    if (response) await fs.remove(response);
  }
}
async function failEvent(
  store: Store,
  eventId: string,
  outcome: HookResult,
  state: "blocked" | "interrupted"
): Promise<ControlResult> {
  const output = await store.tx(async (tx) => {
    const event = await tx.require("events", eventId);
    const execution = await tx.require("executions", event.execution);
    const workflow = await tx.require("workflows", event.workflow);
    event.inFlight = undefined;
    event.status = state;
    event.outcomes.push(outcome);
    workflow.barrier = event.id;
    if (event.action) {
      const action = await tx.require("actions", event.action);
      action.status = "cancelled";
      tx.put("actions", action);
      event.action = undefined;
    }
    const output = eventResult(event, execution, state, {
      exitCode: state === "blocked" ? 3 : outcome.contractError ? 2 : 1,
      retryAllowed: state === "blocked" && event.rounds < event.maxRounds,
      message: outcome.message,
      recovery: eventRecovery(event),
    });
    event.result = output;
    tx.put("events", event);
    tx.put("workflows", workflow);
    return output;
  });
  if (state !== "blocked" && output.payload?.event !== "hook.error") {
    try {
      const { hooks } = await loadRegistry(output.payload!.cwd);
      const payload: HookPayload = {
        ...output.payload!,
        event: "hook.error",
        role: "*",
        phase: "signal",
        summary: `Hook ${outcome.name} failed on ${output.payload!.event}.`,
        failedEvent: output.payload!.event,
      };
      for (const hook of hooksForEvent(hooks, "hook.error"))
        if (
          !checkpoint(hook) &&
          !hook.gate &&
          !["skill", "agent", "prompt"].includes(hook.type)
        )
          await audit(store, payload, await invoke(store, hook, payload));
    } catch {
      /* Original durable failure remains the final control result. */
    }
  }
  return output;
}
async function audit(
  store: Store,
  payload: HookPayload,
  outcome: HookResult
): Promise<void> {
  if (!payload.feature?.dir) return;
  // General logs retain progress metadata, never stdout, payload or feedback.
  const line =
    JSON.stringify({
      at: now(),
      name: outcome.name,
      event: outcome.event,
      kind: outcome.kind,
      status: outcome.status,
      durationMs: outcome.durationMs,
      exitCode: outcome.exitCode,
      runId: payload.runId,
    }) + "\n";
  try {
    await excludeHookLogs(payload.cwd);
    const file = hooksLogPath(payload.cwd, payload.feature.dir);
    await fs.ensureDir(path.dirname(file));
    await fs.appendFile(file, line, { mode: 0o600 });
  } catch (e) {
    const directory = path.join(store.root, "logs");
    await fs.ensureDir(directory, { mode: 0o700 });
    await fs.appendFile(path.join(directory, "audit.jsonl"), line, {
      mode: 0o600,
    });
    throw new ControlError(
      "log-exclusion",
      `Cannot exclude workspace hook logs; audit saved in Git internals: ${(e as Error).message}`
    );
  }
}
async function createCheckpoint(
  store: Store,
  event: EventRecord,
  hook: ResolvedHook
): Promise<ControlResult> {
  try {
    const options = hook.options as unknown as CheckpointOptions;
    const choices = Object.fromEntries(
      Object.entries(options.choices).map(([key, value]) => [
        key,
        freezeChoice(value, event.payload),
      ])
    );
    const question = resolveTemplate(
      options.question,
      { payload: event.payload },
      "none"
    ).value;
    const snapshot = await takeSnapshot(
      event.payload.cwd,
      hook,
      event.payload,
      choices
    );
    return await store.tx(async (tx) => {
      const current = await tx.require("events", event.id);
      if (current.decision)
        return decisionResult(
          tx,
          await tx.require("decisions", current.decision)
        );
      await tx.require("executions", current.execution);
      const workflow = await tx.require("workflows", current.workflow);
      const chain = await tx.require("chains", current.chain);
      const route = `${current.workflow}:${current.name}:${hook.name}`;
      const decision: Decision = {
        id: id("d"),
        workflow: current.workflow,
        execution: current.execution,
        event: current.id,
        chain: current.chain,
        hook: hook.name,
        route,
        status: "pending",
        question,
        choices,
        createdAt: now(),
        expiresAt: new Date(
          Date.now() + duration(options.expiresIn ?? "72h")
        ).toISOString(),
        snapshot,
        options,
        signals: { pending: "intent" },
        ...(options.github
          ? {
              publication: {
                status: "intent",
                marker: "",
              } as Decision["publication"],
            }
          : {}),
      };
      if (decision.publication)
        decision.publication.marker = `<!-- spec-lite:${decision.workflow}:${decision.id} -->`;
      current.decision = decision.id;
      current.status = "pending";
      current.cursor++;
      current.inFlight = undefined;
      workflow.barrier = current.id;
      tx.put("workflows", workflow);
      tx.put("events", current);
      tx.put("decisions", decision);
      tx.file(
        store.feedback(decision.id),
        `# Scoped decision feedback\n\nDecision: ${decision.id}\nStatus: pending\n\nNo feedback has been accepted.\n`
      );
      if (!chain.checkpointRoutes.includes(route) && chain.hops < chain.max) {
        const values = Object.fromEntries(
          describeVars().map((v) => [
            v.name,
            v.resolve({ payload: event.payload }),
          ])
        );
        const rule = options.rules?.find((r) =>
          Object.entries(r.if).every(
            ([key, wanted]) =>
              values[key] !== undefined &&
              values[key]!.trim().toLowerCase() === wanted.trim().toLowerCase()
          )
        );
        if (rule) {
          decision.signals!.pending = "sent";
          chain.checkpointRoutes.push(route);
          tx.put("chains", chain);
          return accept(tx, decision, rule.choose, {
            actor: "configured-rule",
            source: "rule",
            feedback: "",
            rule: {
              rule,
              inputs: Object.fromEntries(
                Object.keys(rule.if).map((key) => [key, values[key]])
              ),
            },
          });
        }
      }
      if (!chain.checkpointRoutes.includes(route))
        chain.checkpointRoutes.push(route);
      tx.put("chains", chain);
      return decisionResult(tx, decision);
    });
  } catch (e) {
    return failEvent(
      store,
      event.id,
      {
        name: hook.name,
        event: event.name,
        kind: hook.type,
        status: "failed",
        durationMs: 0,
        contractError: true,
        message: (e as Error).message,
      },
      "interrupted"
    );
  }
}

export async function next(
  root: string,
  decisionId?: string,
  wait?: string,
  inheritedDeadline?: number,
  all = false
): Promise<ControlResult> {
  try {
    if (wait && !decisionId)
      throw new ControlError("wait-id", "--wait requires a decision ID.", 2);
    const milliseconds = wait ? duration(wait, 60000) : 0;
    const deadline = Date.now() + milliseconds;
    const ioDeadline =
      inheritedDeadline ?? (milliseconds ? deadline : Date.now() + 15000);
    const store = await Store.open(root);
    if (!decisionId) {
      await maybePrune(store);
      const remoteIds = await store.tx(async (tx) =>
        (await tx.list("decisions"))
          .filter(
            (d) =>
              (d.status === "pending" && d.publication) ||
              Object.values(d.signals ?? {}).includes("intent")
          )
          .map((d) => d.id)
      );
      const inspectionErrors: ControlResult[] = [];
      for (const remoteId of remoteIds) {
        if (Date.now() >= ioDeadline) break;
        const inspected = await next(root, remoteId, undefined, ioDeadline);
        if (inspected.error) inspectionErrors.push(inspected);
      }
      return store.tx(async (tx) => {
        const items: ControlResult[] = [];
        for (const d of await tx.list("decisions")) {
          await expire(tx, d);
          if (d.status === "answered") continue;
          // Terminal questions matter only while they still hold their event paused; --all shows history.
          const event = await tx.get("events", d.event);
          if (
            !all &&
            (!event || event.decision !== d.id || event.status !== "pending")
          )
            continue;
          items.push(await decisionResult(tx, d));
        }
        for (const a of await tx.list("actions"))
          if (["ready", "running", "interrupted", "failed"].includes(a.status))
            items.push(await actionResult(tx, a));
        // Root executions have no action record; list them so an interrupted session can be resumed or stopped.
        // One that is waiting at a question or a blocked gate is listed through that item instead.
        const waiting = new Set(
          (await tx.list("events"))
            .filter((e) =>
              ["pending", "blocked", "paused", "interrupted"].includes(e.status)
            )
            .map((e) => e.execution)
        );
        for (const x of await tx.list("executions"))
          if (x.status === "running" && !x.action && !waiting.has(x.id))
            items.push(executionResult(x));
        for (const e of await tx.list("events")) {
          if (
            e.inFlight &&
            sameHost(e.inFlight.host) &&
            !alive(e.inFlight.pid) &&
            !e.inFlight.repeatable
          ) {
            e.status = "interrupted";
            tx.put("events", e);
          }
          if (
            e.status === "blocked" ||
            e.status === "paused" ||
            e.status === "interrupted"
          )
            items.push(
              eventResult(
                e,
                await tx.require("executions", e.execution),
                e.status,
                {
                  retryAllowed:
                    e.status === "blocked" && e.rounds < e.maxRounds,
                  recovery: eventRecovery(e),
                }
              )
            );
        }
        return result("paused", {
          items,
          ...(inspectionErrors.length
            ? {
                exitCode: 1 as const,
                error: {
                  code: "inspection-errors",
                  message: inspectionErrors
                    .map((r) => `${r.decisionId}: ${r.error?.message}`)
                    .join("; "),
                  recovery: "spec-lite next <decision-id>",
                },
              }
            : {}),
          message: items.length
            ? "Inspect saved work; inspection never starts or consumes an action."
            : "No pending work.",
        });
      });
    }
    for (;;) {
      let decision = await store.tx(async (tx) => {
        const d = await tx.require("decisions", decisionId);
        await expire(tx, d);
        return d;
      });
      if (
        decision.status === "pending" &&
        decision.publication &&
        decision.publication.status !== "published"
      ) {
        if (Date.now() < ioDeadline)
          await withGithubBudget(ioDeadline, () =>
            publishDecision(store, decisionId)
          );
        decision = await store.tx((tx) => tx.require("decisions", decisionId));
      }
      if (
        decision.status === "pending" &&
        decision.publication?.status === "published"
      ) {
        if (milliseconds && Date.now() >= deadline)
          return store.tx(async (tx) => ({
            ...(await decisionResult(
              tx,
              await tx.require("decisions", decisionId)
            )),
            wait: "timeout",
          }));
        const polled = await withGithubBudget(ioDeadline, () =>
          pollDecision(store, decision)
        );
        if (milliseconds && polled.error?.includes("operation deadline"))
          return store.tx(async (tx) => ({
            ...(await decisionResult(
              tx,
              await tx.require("decisions", decisionId)
            )),
            wait: "timeout",
          }));
        if (polled.error)
          return result("error", {
            exitCode: 1,
            decisionId,
            decision,
            error: {
              code: "github-poll",
              message: polled.error,
              recovery: `spec-lite next ${decisionId}`,
            },
          });
        // One transaction per poll: examine replies in ascending ID order; the first valid answer wins.
        const ingested = polled.replies.length
          ? await store.tx(async (tx) => {
              const current = await tx.require("decisions", decisionId);
              current.publication ??= decision.publication;
              const examined = new Set(current.publication!.examined ?? []);
              const rejected: number[] = [];
              let accepted:
                { outcome: ControlResult; reply: number } | undefined;
              for (const reply of polled.replies) {
                if (examined.has(reply.id)) continue;
                examined.add(reply.id);
                current.publication!.cursor = reply.updated_at;
                if (accepted || current.status !== "pending") continue;
                if (!reply.choice) {
                  if (reply.rejected) rejected.push(reply.id);
                  continue;
                }
                current.publication!.examined = [...examined];
                accepted = {
                  outcome: await accept(tx, current, reply.choice, {
                    actor: reply.user.login,
                    source: "github",
                    feedback: reply.feedback ?? "",
                    remote: reply,
                  }),
                  reply: reply.id,
                };
              }
              current.publication!.examined = [...examined];
              tx.put("decisions", current);
              return { accepted, rejected };
            })
          : { accepted: undefined, rejected: [] as number[] };
        // Reactions follow persistence; each reply is examined once, so it is reacted to at most once.
        for (const comment of ingested.rejected)
          if (Date.now() < ioDeadline)
            await withGithubBudget(ioDeadline, () =>
              notifyReaction(store, decisionId, comment, "confused")
            );
        if (ingested.accepted?.outcome.status === "ready") {
          if (Date.now() < ioDeadline)
            await withGithubBudget(ioDeadline, () =>
              notifyReaction(store, decisionId, ingested.accepted!.reply)
            );
          await signals(store, decisionId, ioDeadline);
        }
      }
      const inspected = await store.tx(async (tx) => {
        const d = await tx.require("decisions", decisionId);
        await expire(tx, d);
        if (
          d.status === "pending" ||
          (d.status === "answered" &&
            d.action &&
            (await tx.require("actions", d.action)).status === "ready")
        ) {
          const invalid = await checkSnapshot(tx, d);
          if (invalid) return invalid;
        }
        return decisionResult(tx, d);
      });
      await signals(store, decisionId, ioDeadline);
      if (!milliseconds || inspected.status !== "pending") return inspected;
      if (Date.now() >= deadline) return { ...inspected, wait: "timeout" };
      decision = inspected.decision!;
      // Local answers (decide in another terminal) are noticed within a second; GitHub keeps its poll interval.
      // Atomic renames make a lock-free read of the decision record safe here.
      const remote =
        decision.publication?.status === "published"
          ? Date.now() + (decision.options.github?.pollSeconds ?? 30) * 1000
          : Infinity;
      const until = Math.min(deadline, remote, Date.parse(decision.expiresAt));
      while (Date.now() < until) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, Math.min(1000, until - Date.now())))
        );
        const current = (await fs
          .readJson(store.file("decisions", decisionId))
          .catch(() => undefined)) as Decision | undefined;
        if (!current || current.status !== "pending") break;
      }
    }
  } catch (e) {
    return controlFailure(e);
  }
}

export async function manageDecision(
  root: string,
  decisionId: string,
  mode: "cancel" | "reissue",
  reason: string
): Promise<ControlResult> {
  try {
    requireReason(reason);
    const store = await Store.open(root);
    const output = await store.tx(async (tx) => {
      const previous = await tx.require("decisions", decisionId);
      if (previous.action) {
        const action = await tx.require("actions", previous.action);
        if (["running", "interrupted"].includes(action.status))
          throw new ControlError(
            "owner-active",
            "Running/interrupted actions require owner recovery before reissue."
          );
        if (["completed", "stopped", "failed"].includes(action.status))
          throw new ControlError(
            "action-terminal",
            "This decision's action already executed; a new user request must start new work."
          );
        action.status = mode === "cancel" ? "cancelled" : "superseded";
        tx.put("actions", action);
      }
      if (mode === "cancel") {
        if (previous.status === "pending") previous.status = "cancelled";
        previous.reason = reason;
        tx.put("decisions", previous);
        return decisionResult(tx, previous);
      }
      const registry = await loadRegistry(previous.snapshot.workspace);
      const hook = registry.hooks.find(
        (h) => h.name === previous.hook && checkpoint(h)
      );
      if (!hook || registry.issues.some((i) => i.level === "error"))
        throw new ControlError(
          "reissue-config",
          "Restore a valid checkpoint definition before reissue.",
          2
        );
      const options = hook.options as unknown as CheckpointOptions;
      const choices = Object.fromEntries(
        Object.entries(options.choices).map(([key, value]) => [
          key,
          freezeChoice(value, previous.snapshot.payload),
        ])
      );
      const snapshot = await takeSnapshot(
        previous.snapshot.workspace,
        hook,
        previous.snapshot.payload,
        choices
      );
      const decision: Decision = {
        ...structuredClone(previous),
        id: id("d"),
        status: "pending",
        previous: previous.id,
        reason,
        options,
        snapshot,
        choices,
        question: resolveTemplate(
          options.question,
          { payload: snapshot.payload },
          "none"
        ).value,
        createdAt: now(),
        expiresAt: new Date(
          Date.now() + duration(options.expiresIn ?? "72h")
        ).toISOString(),
        action: undefined,
        answer: undefined,
        publication: options.github
          ? { status: "intent", marker: "" }
          : undefined,
        signals: { pending: "intent" },
      };
      if (decision.publication)
        decision.publication.marker = `<!-- spec-lite:${decision.workflow}:${decision.id} -->`;
      if (previous.status === "pending") previous.status = "superseded";
      previous.reason = reason;
      const event = await tx.require("events", previous.event);
      event.decision = decision.id;
      event.action = undefined;
      event.status = "pending";
      tx.put("events", event);
      tx.put("decisions", previous);
      tx.put("decisions", decision);
      tx.file(
        store.feedback(decision.id),
        `# Scoped decision feedback\n\nSource: local-session\nReissued from: ${previous.id}\nReason: ${JSON.stringify(reason)}\n\nNo feedback has been accepted.\n`
      );
      return decisionResult(tx, decision);
    });
    if (mode === "reissue" && output.decisionId) {
      await publishDecision(store, output.decisionId);
      await signals(store, output.decisionId);
    }
    return output;
  } catch (e) {
    return controlFailure(e);
  }
}
function requireReason(reason: string): void {
  if (!reason?.trim())
    throw new ControlError(
      "reason-required",
      "Management requires the user's instruction in --reason; do not invent one.",
      2
    );
}
export async function recoverAction(
  root: string,
  actionId: string,
  generation: number,
  mode: "retry" | "stop",
  reason: string
): Promise<ControlResult> {
  try {
    requireReason(reason);
    if (!["retry", "stop"].includes(mode))
      throw new ControlError(
        "recovery-mode",
        "Action recovery mode must be retry or stop.",
        2
      );
    const store = await Store.open(root);
    return await store.tx(async (tx) => {
      const action = await tx.require("actions", actionId);
      if (action.generation !== generation)
        throw new ControlError(
          "stale-generation",
          `Current generation is ${action.generation}; inspect before recovery.`
        );
      if (!["running", "interrupted", "failed"].includes(action.status))
        throw new ControlError(
          "recovery-state",
          `Cannot recover ${action.status} action.`
        );
      action.history.push({
        generation: action.generation,
        owner: action.owner,
        status: action.status,
        outcome: action.outcome,
      });
      action.recoveries.push({
        source: "local-session",
        reason,
        at: now(),
        generation,
        mode,
      });
      if (action.owner) {
        const previous = await tx.require("executions", action.owner.execution);
        previous.status = mode === "stop" ? "stopped" : "interrupted";
        tx.put("executions", previous);
      }
      action.generation++;
      action.owner = undefined;
      action.outcome = undefined;
      action.status = mode === "stop" ? "stopped" : "ready";
      const event = await tx.require("events", action.event);
      event.status = mode === "stop" ? "stopped" : "pending";
      const workflow = await tx.require("workflows", action.workflow);
      workflow.barrier = mode === "stop" ? undefined : event.id;
      if (mode === "retry") {
        const chain = newChain((await tx.require("chains", action.chain)).max);
        tx.put("chains", chain);
        action.chain = chain.id;
      }
      tx.put("events", event);
      tx.put("workflows", workflow);
      tx.put("actions", action);
      return actionResult(tx, action);
    });
  } catch (e) {
    return controlFailure(e);
  }
}
export const RETENTION_MS = 30 * 86400000;
const PRUNE_INTERVAL_MS = 86400000;
/** Opportunistic daily pruning; failures never affect the calling command. */
async function maybePrune(store: Store): Promise<void> {
  const marker = path.join(store.root, "last-prune");
  try {
    const stat = await fs.stat(marker).catch(() => undefined);
    if (stat && Date.now() - stat.mtimeMs < PRUNE_INTERVAL_MS) return;
    await fs.outputFile(marker, now(), { mode: 0o600 });
    await pruneRuntime(store);
  } catch {
    /* Retention is best-effort. */
  }
}
/**
 * Removes workflows whose every record is terminal and untouched for the retention period.
 * Paused, blocked, interrupted or running work is never removed, nor a workflow another workflow names as parent.
 * Deletion runs dependents first, so an interrupted prune leaves only unreferenced terminal files.
 */
export async function pruneRuntime(
  store: Store,
  at = Date.now(),
  retentionMs = RETENTION_MS
): Promise<string[]> {
  return store.tx(async (tx) => {
    const [workflows, executions, events, decisions, actions] =
      await Promise.all([
        tx.list("workflows"),
        tx.list("executions"),
        tx.list("events"),
        tx.list("decisions"),
        tx.list("actions"),
      ]);
    const terminal = {
      executions: ["completed", "stopped", "replaced"],
      events: ["completed", "replaced", "stopped"],
      actions: ["completed", "stopped", "cancelled", "superseded"],
    };
    const parents = new Set(workflows.map((w) => w.parent).filter(Boolean));
    const modified = async (
      kind: "executions" | "events" | "decisions" | "actions" | "workflows",
      key: string
    ) =>
      (await fs.stat(store.file(kind, key)).catch(() => undefined))?.mtimeMs ??
      at;
    const pruned: string[] = [];
    for (const workflow of workflows) {
      if (workflow.barrier || parents.has(workflow.id)) continue;
      const own = {
        executions: executions.filter((r) => r.workflow === workflow.id),
        events: events.filter((r) => r.workflow === workflow.id),
        decisions: decisions.filter((r) => r.workflow === workflow.id),
        actions: actions.filter((r) => r.workflow === workflow.id),
      };
      if (
        own.executions.some((r) => !terminal.executions.includes(r.status)) ||
        own.events.some((r) => !terminal.events.includes(r.status)) ||
        own.actions.some((r) => !terminal.actions.includes(r.status)) ||
        own.decisions.some((r) => r.status === "pending")
      )
        continue;
      const times = await Promise.all([
        modified("workflows", workflow.id),
        ...own.executions.map((r) => modified("executions", r.id)),
        ...own.events.map((r) => modified("events", r.id)),
        ...own.decisions.map((r) => modified("decisions", r.id)),
        ...own.actions.map((r) => modified("actions", r.id)),
      ]);
      if (at - Math.max(...times) < retentionMs) continue;
      for (const d of own.decisions)
        await fs.remove(path.dirname(store.file("decisions", d.id)));
      for (const a of own.actions) await fs.remove(store.file("actions", a.id));
      for (const e of own.events) await fs.remove(store.file("events", e.id));
      for (const x of own.executions)
        await fs.remove(store.file("executions", x.id));
      await fs.remove(store.file("threads", workflow.id));
      await fs.remove(store.file("workflows", workflow.id));
      pruned.push(workflow.id);
    }
    if (pruned.length) {
      const gone = new Set(pruned);
      const kept = [...executions, ...events, ...decisions, ...actions].filter(
        (r) => !gone.has(r.workflow)
      );
      const chains = new Set(kept.map((r) => r.chain));
      for (const c of await tx.list("chains"))
        if (!chains.has(c.id)) await fs.remove(store.file("chains", c.id));
    }
    return pruned;
  });
}
/**
 * The `hook recover` command for an event that needs a person's decision: a gate past its retry
 * budget, an interrupted hook, or a paused chain. A gate still within budget is retried by the agent.
 */
function eventRecovery(event: EventRecord): string | undefined {
  const base = `spec-lite hook recover ${event.id} --generation ${event.generation}`;
  if (event.status === "blocked") {
    if (event.rounds < event.maxRounds) return undefined;
    const gates = event.hooks.filter((h) => h.gate).map((h) => h.name);
    return `${base} --mode retry|stop|override --reason <user-instruction> (override needs --checks ${gates.join(",")})`;
  }
  if (event.status === "interrupted" || event.status === "paused")
    return `${base} --mode retry|stop --reason <user-instruction>`;
  return undefined;
}
function recoverCommand(execution: Execution): string {
  return execution.action
    ? `spec-lite action recover ${execution.action} --generation ${execution.generation} --mode retry|stop --reason <user-instruction>`
    : `spec-lite execution recover ${execution.id} --generation ${execution.generation} --mode resume|stop --reason <user-instruction>`;
}
function executionResult(
  execution: Execution,
  fields: Partial<ControlResult> = {}
): ControlResult {
  const last = Object.values(execution.events).at(-1);
  return result("running", {
    workflowId: execution.workflow,
    executionId: execution.id,
    eventId: last,
    context: context(execution),
    message: `Execution ${execution.id} (${execution.role}) is still running from ${execution.createdAt}. If its session ended, ask the user whether to resume or stop it.`,
    ...fields,
    recovery:
      "recovery" in fields ? fields.recovery : recoverCommand(execution),
  });
}
/**
 * User-directed reconciliation of a root execution whose session ended. Resume records a successor
 * generation and returns the context to carry; stop ends the execution and releases its paused work.
 */
export async function recoverExecution(
  root: string,
  executionId: string,
  generation: number,
  mode: "resume" | "stop",
  reason: string
): Promise<ControlResult> {
  try {
    requireReason(reason);
    if (!["resume", "stop"].includes(mode))
      throw new ControlError(
        "recovery-mode",
        "Execution recovery mode must be resume or stop.",
        2
      );
    const store = await Store.open(root);
    return await store.tx(async (tx) => {
      const execution = await tx.require("executions", executionId);
      if (execution.action)
        throw new ControlError(
          "action-owned",
          `Execution ${execution.id} owns action ${execution.action}; use action recover.`,
          2,
          recoverCommand(execution)
        );
      if (execution.generation !== generation)
        throw new ControlError(
          "stale-generation",
          `Current generation is ${execution.generation}; inspect before recovery.`,
          1,
          "spec-lite next"
        );
      if (execution.status !== "running")
        throw new ControlError(
          "recovery-state",
          `Cannot recover ${execution.status} execution.`,
          1,
          "spec-lite next"
        );
      const events: EventRecord[] = [];
      for (const eventId of Object.values(execution.events)) {
        const event = await tx.get("events", eventId);
        if (event) events.push(event);
      }
      const busy = events.find(
        (e) =>
          e.inFlight && (!sameHost(e.inFlight.host) || alive(e.inFlight.pid))
      );
      if (busy)
        throw new ControlError(
          "effect-owner-active",
          `Hook ${busy.inFlight!.hook} is still running for event ${busy.id}; stop that process first.`
        );
      const children = (await tx.list("executions")).filter(
        (e) => e.parent === execution.id && e.status === "running"
      );
      if (mode === "stop" && children.length)
        throw new ControlError(
          "children-active",
          `Stop running child executions first: ${children.map((c) => c.id).join(", ")}.`,
          1,
          "spec-lite next"
        );
      execution.recoveries = [
        ...(execution.recoveries ?? []),
        { source: "local-session", reason, at: now(), generation, mode },
      ];
      execution.generation++;
      if (mode === "resume") {
        tx.put("executions", execution);
        return executionResult(execution, {
          message: `Resumed ${execution.id} on the user's instruction. Carry --execution ${execution.id} on later events; make sure the earlier session is no longer running.`,
          recovery: undefined,
        });
      }
      const workflow = await tx.require("workflows", execution.workflow);
      for (const event of events) {
        if (
          !["running", "blocked", "pending", "paused", "interrupted"].includes(
            event.status
          )
        )
          continue;
        if (event.decision) {
          const d = await tx.require("decisions", event.decision);
          if (d.status === "pending") {
            d.status = "cancelled";
            d.reason = reason;
            tx.put("decisions", d);
          }
        }
        if (event.action) {
          const a = await tx.require("actions", event.action);
          if (a.status === "ready") {
            a.status = "cancelled";
            tx.put("actions", a);
          }
        }
        event.status = "stopped";
        event.inFlight = undefined;
        event.generation++;
        tx.put("events", event);
        if (workflow.barrier === event.id) workflow.barrier = undefined;
      }
      execution.status = "stopped";
      tx.put("executions", execution);
      tx.put("workflows", workflow);
      return result("stopped", {
        workflowId: execution.workflow,
        executionId: execution.id,
        context: context(execution),
        message: `Stopped ${execution.id}; its scope can start a new execution.`,
      });
    });
  } catch (e) {
    return controlFailure(e);
  }
}
export async function recoverEvent(
  root: string,
  eventId: string,
  generation: number,
  mode: "retry" | "stop" | "override",
  reason: string,
  checks: string[] = []
): Promise<ControlResult> {
  try {
    requireReason(reason);
    if (!["retry", "stop", "override"].includes(mode))
      throw new ControlError(
        "recovery-mode",
        "Hook recovery mode must be retry, stop or override.",
        2
      );
    const store = await Store.open(root);
    const saved = await store.tx(async (tx) => {
      const event = await tx.require("events", eventId);
      const execution = await tx.require("executions", event.execution);
      const workflow = await tx.require("workflows", event.workflow);
      if (event.generation !== generation)
        throw new ControlError(
          "stale-generation",
          `Current event generation is ${event.generation}.`
        );
      const terminalQuestion = event.decision
        ? await tx.require("decisions", event.decision)
        : undefined;
      const terminalPending =
        event.status === "pending" &&
        terminalQuestion &&
        ["expired", "cancelled", "superseded"].includes(
          terminalQuestion.status
        );
      if (
        !["blocked", "paused", "interrupted"].includes(event.status) &&
        !(terminalPending && mode === "stop")
      )
        throw new ControlError(
          "recovery-state",
          `Cannot recover ${event.status} event.`,
          1,
          terminalPending
            ? `spec-lite decision reissue ${terminalQuestion.id} --reason <user-instruction>; or hook recover ${event.id} --generation ${event.generation} --mode stop --reason <user-instruction>`
            : "spec-lite next"
        );
      if (
        event.inFlight &&
        (!sameHost(event.inFlight.host) || alive(event.inFlight.pid))
      )
        throw new ControlError(
          "effect-owner-active",
          "Stop and reconcile the active hook process before recovery."
        );
      if (
        mode === "override" &&
        (!checks.length ||
          checks.some(
            (name) => !event.hooks.some((h) => h.name === name && h.gate)
          ))
      )
        throw new ControlError(
          "named-checks",
          "Override requires --checks naming gates in this event.",
          2
        );
      event.recoveries.push({
        source: "local-session",
        reason,
        at: now(),
        generation,
        mode,
        checks,
      });
      event.generation++;
      event.inFlight = undefined;
      if (mode === "stop") {
        event.status = "stopped";
        execution.status = "stopped";
        workflow.barrier = undefined;
        if (event.action) {
          const action = await tx.require("actions", event.action);
          action.status = "cancelled";
          tx.put("actions", action);
        }
        if (execution.action) {
          const owning = await tx.require("actions", execution.action);
          if (owning.owner?.execution === execution.id) {
            owning.status = "stopped";
            owning.outcome = "stopped";
            tx.put("actions", owning);
          }
        }
        tx.put("events", event);
        tx.put("executions", execution);
        tx.put("workflows", workflow);
        return eventResult(event, execution, "stopped");
      }
      const chain = newChain((await tx.require("chains", event.chain)).max);
      tx.put("chains", chain);
      event.chain = chain.id;
      execution.chain = chain.id;
      if (event.action) {
        const prepared = await tx.require("actions", event.action);
        if (prepared.status === "ready") {
          prepared.chain = chain.id;
          tx.put("actions", prepared);
        } else if (["cancelled", "superseded"].includes(prepared.status)) {
          // A stale static definition cannot be adopted silently; stop then explicitly start new work.
          throw new ControlError(
            "stale-route",
            "Prepared route is stale; use explicit stop, then a new user-requested execution.",
            1,
            `spec-lite hook recover ${event.id} --generation ${event.generation - 1} --mode stop --reason <user-instruction>`
          );
        }
      }
      if (event.status === "blocked") {
        event.rounds = 1;
        event.episode++;
        event.cursor = event.hooks.findIndex((h) => h.gate);
      }
      // An uncertain ordinary effect is replayed only on an explicit reconciled retry instruction.
      event.status = "running";
      event.result = undefined;
      if (mode === "override") event.overrides.push(...checks);
      workflow.barrier = undefined;
      tx.put("events", event);
      tx.put("executions", execution);
      tx.put("workflows", workflow);
      return event.id;
    });
    return typeof saved === "string"
      ? dispatchEvent(store, saved, true)
      : saved;
  } catch (e) {
    return controlFailure(e);
  }
}
/** Signals have durable IDs and uncertain delivery is visible, never silently replayed. */
async function signals(
  store: Store,
  decisionId: string,
  deadline = Date.now() + 15000
): Promise<void> {
  for (const kind of ["pending", "resolved"] as const) {
    if (Date.now() >= deadline) return;
    const prepared = await store.tx(async (tx) => {
      const decision = await tx.require("decisions", decisionId);
      if (decision.signals?.[kind] !== "intent") return undefined;
      decision.signals[kind] = "sending";
      tx.put("decisions", decision);
      return decision;
    });
    if (!prepared) continue;
    let status: "sent" | "uncertain" = "sent";
    try {
      const { hooks } = await loadRegistry(prepared.snapshot.workspace);
      const payload: HookPayload = {
        ...prepared.snapshot.payload,
        event: `checkpoint.${kind}`,
        role: "*",
        phase: "signal",
        runId: `${prepared.id}-${kind}`,
        decision: {
          id: prepared.id,
          question: prepared.question,
          status: prepared.status,
          choice: prepared.answer?.choice,
          actor: prepared.answer?.actor,
          feedbackFile: prepared.answer
            ? store.feedback(prepared.id)
            : undefined,
          url: prepared.publication?.destination?.url,
        },
        workflow: { id: prepared.workflow },
        summary: `Checkpoint ${prepared.id} ${kind}`,
      };
      for (const hook of hooksForEvent(hooks, payload.event)) {
        if (
          hook.gate ||
          checkpoint(hook) ||
          ["skill", "agent", "prompt"].includes(hook.type)
        )
          continue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          status = "uncertain";
          break;
        }
        const output = await invoke(
          store,
          { ...hook, timeoutMs: Math.min(hook.timeoutMs ?? 30000, remaining) },
          payload
        );
        if (output.status === "failed") status = "uncertain";
      }
    } catch {
      status = "uncertain";
    }
    await store.tx(async (tx) => {
      const d = await tx.require("decisions", decisionId);
      d.signals![kind] = status;
      tx.put("decisions", d);
    });
  }
}
