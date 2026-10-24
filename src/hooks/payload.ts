/**
 * Build the HookPayload for one `hook run` invocation, and keep it fresh as
 * builtins mutate changeset.json mid-chain.
 */
import crypto from "node:crypto";
import fs from "fs-extra";
import { getEvent } from "./events.js";
import {
  changesetLocation,
  resolveFeature,
  resolveProvider,
} from "./workspace.js";
import { currentHead, readChangeset } from "./changeset.js";
import type { HookPayload, ChangesPayload } from "./types.js";

export interface BuildPayloadOptions {
  root: string;
  event: string;
  featureId?: string;
  taskId?: string;
  runId?: string;
  /** Overrides the alias read from `.spec-lite.json`; mainly for tests. */
  provider?: string;
  extra?: Record<string, string>;
}

/** The run's changeset, with HEAD read live: changeset.json records no HEAD, so committing it is idempotent. */
async function changesFor(
  root: string,
  location: string
): Promise<ChangesPayload | undefined> {
  const doc = await readChangeset(root, location);
  if (!doc) return undefined;
  return {
    source: doc.vcs === "git" ? "git" : "none",
    baseline: doc.baseline?.sha,
    head: doc.vcs === "git" ? await currentHead(root) : undefined,
    files: doc.files.map((f) => ({
      path: f.path,
      status: f.status,
      role: f.role,
      task: f.task,
    })),
  };
}

export async function buildPayload(
  opts: BuildPayloadOptions
): Promise<HookPayload> {
  const event = getEvent(opts.event);
  const role = event?.role ?? opts.event.split(".")[0];
  const phase = event?.phase ?? "post";

  const payload: HookPayload = {
    hooksVersion: 1,
    event: opts.event,
    role,
    phase,
    runId: opts.runId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: opts.root,
    // Always a string, so ${provider} resolves on every event rather than
    // failing closed on repositories that never configured a harness.
    provider: opts.provider ?? (await resolveProvider(opts.root)),
    ...(opts.extra ?? {}),
  };

  if (opts.featureId) {
    const feature = await resolveFeature(opts.root, opts.featureId);
    payload.feature = feature ?? { id: opts.featureId.toUpperCase() };
  }
  await refreshChanges(opts.root, payload);

  if (opts.taskId) payload.task = { id: opts.taskId };

  return payload;
}

/** Re-read changeset.json after a builtin runs, so later hooks in the same chain see it. */
export async function refreshChanges(
  root: string,
  payload: HookPayload
): Promise<void> {
  const location = changesetLocation(payload);
  if (!location) return;
  const changes = await changesFor(root, location);
  if (changes) payload.changes = changes;
}

/** Write the payload to a temp file for ${payload.file} and stdin-consuming executors. */
export async function writePayloadFile(payload: HookPayload): Promise<string> {
  const os = await import("node:os");
  const path = await import("node:path");
  const file = path.join(os.tmpdir(), `spec-lite-hook-${payload.runId}.json`);
  await fs.writeJson(file, payload);
  return file;
}
