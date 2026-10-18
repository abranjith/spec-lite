import path from "node:path";
import fs from "fs-extra";
import type { Command } from "commander";
import {
  next,
  decide,
  startAction,
  completeAction,
  manageDecision,
  recoverAction,
  recoverExecution,
  controlFailure,
} from "../hooks/control/engine.js";
import type { ControlResult } from "../hooks/control/types.js";

/**
 * What the calling agent needs: IDs, status, question/choices and commands. Approval snapshots,
 * stored options and publication bookkeeping stay in the store (`--verbose` shows them).
 */
export function publicView(outcome: ControlResult): ControlResult {
  const view: ControlResult = { ...outcome };
  if (view.decision) {
    const {
      snapshot: _snapshot,
      options: _options,
      publication,
      ...decision
    } = view.decision;
    view.decision = {
      ...decision,
      ...(publication
        ? {
            publication: {
              status: publication.status,
              destination: publication.destination,
              error: publication.error,
            },
          }
        : {}),
    } as ControlResult["decision"];
  }
  if (view.action) {
    const { snapshot: _snapshot, history: _history, ...action } = view.action;
    view.action = action as ControlResult["action"];
  }
  if (view.items) view.items = view.items.map(publicView);
  return view;
}
export function renderControl(
  full: ControlResult,
  json = false,
  verbose = false
): void {
  const outcome = verbose ? full : publicView(full);
  if (json) console.log(JSON.stringify(outcome));
  else {
    if (outcome.context)
      console.log(
        `SPEC-LITE-CONTEXT ${JSON.stringify({ workflow: outcome.workflowId, execution: outcome.executionId, event: outcome.eventId, action: outcome.actionId, ...outcome.context })}`
      );
    const worktree = outcome.payload?.worktree;
    if (worktree) console.log(`SPEC-LITE-WORKTREE ${JSON.stringify(worktree)}`);
    if (outcome.decision) {
      console.log(
        JSON.stringify({
          question: outcome.decision.question,
          choices: outcome.decision.choices,
          expiresAt: outcome.decision.expiresAt,
          url: outcome.decision.publication?.destination?.url,
        })
      );
      if (outcome.decision.status === "pending")
        console.log(`Answer: spec-lite decide ${outcome.decision.id} <choice>`);
    }
    if (outcome.startCommand) console.log(`Start: ${outcome.startCommand}`);
    if (outcome.recovery)
      console.log(
        `Recover (only on the user's instruction): ${outcome.recovery}`
      );
    for (const item of outcome.items ?? [])
      if (item.recovery)
        console.log(
          `Recover ${item.executionId ?? item.eventId}: ${item.recovery}`
        );
    if (outcome.message) console.error(outcome.message);
    if (outcome.error)
      console.error(
        `${outcome.error.code}: ${outcome.error.message}${outcome.error.recovery ? `\nRecovery: ${outcome.error.recovery}` : ""}`
      );
    const markers: Record<string, string> = {
      continue: "CONTINUE",
      pending: "CHECKPOINT",
      ready: "ACTION",
      started: "DIRECTIVE",
      blocked: "BLOCK",
      stopped: "STOP",
      error: "ERROR",
    };
    console.log(
      `SPEC-LITE-${markers[outcome.status] ?? "STATE"} ${JSON.stringify(outcome)}`
    );
  }
  process.exitCode = outcome.exitCode;
}
function guarded(
  action: () => Promise<ControlResult>,
  json?: boolean
): Promise<void> {
  return action().then(
    (r) => renderControl(r, json),
    (e) => renderControl(controlFailure(e), json)
  );
}
export function registerControlCommands(program: Command): void {
  program
    .command("next [decision-id]")
    .description(
      "Inspect/list saved work and collect eligible replies; never starts or consumes"
    )
    .option(
      "--wait <duration>",
      "Finite wait (maximum 60s; fit the host's tool budget)"
    )
    .option(
      "--all",
      "Include terminal history (superseded, cancelled, expired)"
    )
    .option("--json", "Machine-readable output")
    .option("--verbose", "Include stored approval snapshots and options")
    .action(async (decisionId, options) =>
      renderControl(
        await next(
          process.cwd(),
          decisionId,
          options.wait,
          undefined,
          options.all
        ),
        options.json,
        options.verbose
      )
    );
  program
    .command("decide <id> <choice>")
    .description(
      "Record the user's answer; the selected action stays unclaimed"
    )
    .option("--feedback <text>", "Scoped task feedback")
    .option("--feedback-file <path>", "UTF-8 feedback file")
    .option("--json", "Machine-readable output")
    .action(async (decisionId, choice, options) =>
      guarded(async () => {
        if (
          options.feedback !== undefined &&
          options.feedbackFile !== undefined
        )
          return controlFailure(
            new Error("Use either --feedback or --feedback-file.")
          );
        const feedback = options.feedbackFile
          ? await fs.readFile(
              path.resolve(process.cwd(), options.feedbackFile),
              "utf8"
            )
          : (options.feedback ?? "");
        return decide(process.cwd(), decisionId, choice, feedback);
      }, options.json)
    );
  const action = program
    .command("action")
    .description("Acknowledge starts/completion and explicit owner recovery");
  action
    .command("start <id>")
    .option("--execution <origin-id>", "Required origin for continue/stop")
    .option("--json", "Machine-readable output")
    .action(async (actionId, options) =>
      renderControl(
        await startAction(process.cwd(), actionId, options.execution),
        options.json
      )
    );
  action
    .command("complete <id>")
    .requiredOption("--execution <id>", "Owning execution")
    .requiredOption("--outcome <outcome>", "success, failed or stopped")
    .option("--json", "Machine-readable output")
    .action(async (actionId, options) =>
      renderControl(
        await completeAction(
          process.cwd(),
          actionId,
          options.execution,
          options.outcome
        ),
        options.json
      )
    );
  action
    .command("recover <id>")
    .requiredOption("--generation <n>", "Observed generation", Number)
    .requiredOption("--mode <mode>", "retry or stop")
    .requiredOption("--reason <text>", "User's reconciliation instruction")
    .option("--json", "Machine-readable output")
    .action(async (actionId, options) =>
      renderControl(
        await recoverAction(
          process.cwd(),
          actionId,
          options.generation,
          options.mode,
          options.reason
        ),
        options.json
      )
    );
  program
    .command("execution")
    .description("Reconcile a running execution whose session ended")
    .command("recover <id>")
    .requiredOption("--generation <n>", "Observed generation", Number)
    .requiredOption("--mode <mode>", "resume or stop")
    .requiredOption("--reason <text>", "User's reconciliation instruction")
    .option("--json", "Machine-readable output")
    .action(async (executionId, options) =>
      renderControl(
        await recoverExecution(
          process.cwd(),
          executionId,
          options.generation,
          options.mode,
          options.reason
        ),
        options.json
      )
    );
  const decision = program
    .command("decision")
    .description("Explicitly cancel or replace a saved question");
  for (const mode of ["cancel", "reissue"] as const)
    decision
      .command(`${mode} <id>`)
      .requiredOption("--reason <text>", "User's instruction")
      .option("--json", "Machine-readable output")
      .action(async (decisionId, options) =>
        renderControl(
          await manageDecision(process.cwd(), decisionId, mode, options.reason),
          options.json
        )
      );
}
