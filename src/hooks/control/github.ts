/** Optional GitHub channel. All HTTP is outside state transactions. */
import fs from "fs-extra";
import { AsyncLocalStorage } from "node:async_hooks";
import { git, runProgram } from "../builtins/git-workflow.js";
import { githubRepository } from "../builtins/pull-request.js";
import type { HookPayload, ResolvedHook } from "../types.js";
import { Store, id, owner, sameHost, alive, hash } from "./store.js";
import { ControlError, type CheckpointOptions, type Decision, type Publication, type Thread } from "./types.js";
import { takeSnapshot } from "./snapshot.js";
import { resolveTemplate } from "../interpolation.js";

export interface GithubReply {
  id: number; body: string; user: { id: number; login: string; type?: string }; created_at: string; updated_at: string;
  choice?: string; feedback?: string;
  /** An approver's command that names this decision but cannot answer it (typo, edit, expiry). */
  rejected?: boolean;
}
class GithubError extends Error { constructor(message: string, readonly retryAfter = 0) { super(message); } }
const operationDeadline = new AsyncLocalStorage<number>();
export const withGithubBudget = <T>(deadline: number, action: () => Promise<T>): Promise<T> => operationDeadline.run(deadline, action);
async function boundedProgram(store: Store, args: string[]): Promise<string> {
  const remaining = Math.min(15000, (operationDeadline.getStore() ?? Date.now() + 15000) - Date.now());
  if (remaining <= 0) throw new GithubError("GitHub operation deadline reached.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([runProgram(store.workspace, "gh", args, remaining), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new GithubError("GitHub operation deadline reached.")), remaining); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function repoParts(raw: string): { host: string; repo: string } {
  const parts = raw.split("/");
  const host = parts.length === 3 ? parts.shift()! : "github.com";
  if (parts.length !== 2 || !/^[a-zA-Z0-9.-]+$/.test(host) || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) throw new ControlError("github-repo", "GitHub repo must be OWNER/REPO or HOST/OWNER/REPO.", 2);
  return { host, repo: parts.join("/") };
}
async function api(store: Store, host: string, endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  let file: string | undefined;
  try {
    const args = ["api", "--hostname", host, "--include", "--method", method, endpoint];
    if (body !== undefined) { file = await store.temp("post-body.json"); await fs.writeJson(file, body, { mode: 0o600 }); args.push("--input", file); }
    let output: string;
    try { output = await boundedProgram(store, args); }
    catch (e) {
      const failed = e as Error & { stdout?: string; stderr?: string };
      const metadata = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
      if (/retry-after:|x-ratelimit-remaining:\s*0|HTTP\/\S+\s+429/i.test(metadata)) {
        const retry = Number(/retry-after:\s*(\d+)/i.exec(metadata)?.[1] ?? 0) * 1000;
        const reset = Number(/x-ratelimit-reset:\s*(\d+)/i.exec(metadata)?.[1] ?? 0) * 1000 - Date.now();
        throw new GithubError("GitHub rate limit reached; try again after its retry interval.", Math.max(retry, reset, 30000));
      }
      throw e;
    }
    // gh --include preserves Retry-After/rate metadata; tests may return bare JSON.
    const boundary = output.search(/\r?\n\r?\n/);
    const headers = /^HTTP\//i.test(output) && boundary >= 0 ? output.slice(0, boundary) : "";
    const content = headers ? output.slice(boundary).trim() : output.trim();
    if (/^HTTP\/\S+\s+(?:429|403)/i.test(headers)) throw new GithubError("GitHub rate limit reached; resume with next after the retry interval.", Number(/retry-after:\s*(\d+)/i.exec(headers)?.[1] ?? 30) * 1000);
    if (/^HTTP\/\S+\s+[45]/i.test(headers)) throw new GithubError(`GitHub request failed (${headers.split(/\r?\n/)[0]}).`);
    return content ? JSON.parse(content) : undefined;
  } finally { if (file) await fs.remove(file); }
}
async function pages<T>(store: Store, host: string, endpoint: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 1000; page++) {
    const rows = await api(store, host, `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new GithubError("GitHub paginated endpoint returned a non-array.");
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw new GithubError("GitHub pagination exceeded the bounded page budget; use a new workflow thread.");
}
/** Early-exit pagination with a small page budget, for lookups whose match is known to be recent. */
async function findInPages<T>(store: Store, host: string, endpoint: string, match: (row: T) => boolean, maxPages: number): Promise<T | undefined> {
  for (let page = 1; page <= maxPages; page++) {
    const rows = await api(store, host, `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new GithubError("GitHub paginated endpoint returned a non-array.");
    const found = (rows as T[]).find(match);
    if (found || rows.length < 100) return found;
  }
  return undefined;
}
async function visibility(store: Store, host: string, repo: string, allowPublic?: boolean): Promise<string> {
  const metadata = await api(store, host, `repos/${repo}`) as { private?: boolean; visibility?: string };
  const value = metadata.visibility ?? (metadata.private === true ? "private" : metadata.private === false ? "public" : "unknown");
  if (value === "unknown") throw new GithubError("GitHub did not report repository visibility; publication remains paused.");
  if (value === "public" && allowPublic !== true) throw new GithubError(`Posting to public ${host}/${repo} requires github.allowPublic: true.`);
  return value;
}
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LIMIT = 48 * 1024;
function prefixBytes(text: string, bytes: number): string {
  let result = ""; let count = 0;
  for (const character of text) { const size = Buffer.byteLength(character); if (count + size > bytes) break; result += character; count += size; }
  return result;
}
export async function publicationBody(decision: Decision): Promise<{ body: string; truncated: string[] }> {
  let body = `${decision.publication!.marker}\nWorkflow ${decision.workflow} · decision ${decision.id}\n\n${escaped(decision.question)}\n\n`;
  for (const [key, choice] of Object.entries(decision.choices)) body += `- **${key}**: ${escaped(choice.description)} — reply \`/${key} ${decision.id}\`\n`;
  body += `\nExpires ${decision.expiresAt}. First locally accepted valid answer wins. Optional feedback is scoped task input.\n`;
  const originEffects = decision.snapshot.payload.completedEffects;
  if (Array.isArray(originEffects) && originEffects.length) body += `\nCompleted effects: ${escaped(originEffects.join(", "))}\n`;
  const withheld = decision.snapshot.files.filter((f) => f.withheld);
  if (withheld.length) body += `\nWithheld attachments (payload paths outside .spec-lite/; list them literally in attach to publish): ${escaped(withheld.map((f) => f.path).join(", "))}\n`;
  const attachments = decision.snapshot.files.filter((f) => f.publish);
  const metadata = attachments.map((file) => `\nAttachment ${escaped(file.path)} (SHA-256 ${file.hash})\n`).join("");
  if (Buffer.byteLength(body + metadata) > LIMIT - 128) throw new GithubError("Question/choices/attachment metadata exceed the 48 KiB whole-comment budget; shorten them and reissue.");
  const truncated: string[] = [];
  for (let index = 0; index < attachments.length; index++) {
    const file = attachments[index];
    const heading = `\nAttachment ${escaped(file.path)} (SHA-256 ${file.hash})\n`;
    const reserve = attachments.slice(index + 1).reduce((total, other) => total + Buffer.byteLength(`\nAttachment ${escaped(other.path)} (SHA-256 ${other.hash})\n`) + 128, 0);
    const budget = Math.max(0, LIMIT - Buffer.byteLength(body + heading) - reserve - 180);
    const original = await fs.readFile(file.realPath);
    if (hash(original) !== file.hash) throw new GithubError(`Attachment ${file.path} changed after approval; reissue before publication.`);
    const content = escaped(original.toString("utf8"));
    const display = prefixBytes(content, budget);
    const note = display.length < content.length ? "\n[Display truncated; full approval hash retained.]" : "";
    if (note) truncated.push(file.path);
    body += `${heading}<pre>${display}</pre>${note}\n`;
  }
  if (Buffer.byteLength(body) > LIMIT) throw new GithubError("Comment exceeds the 48 KiB UTF-8 budget.");
  return { body, truncated };
}
export async function previewPublication(store: Store, hook: ResolvedHook, payload: HookPayload): Promise<unknown> {
  const options = hook.options as unknown as CheckpointOptions;
  const snapshot = await takeSnapshot(store.workspace, hook, payload, options.choices);
  let destination: unknown;
  if (options.github) {
    const repo = repoParts(options.github.repo ?? githubRepository(await git(store.workspace, ["remote", "get-url", "origin"])));
    // Read-only API call: no state/lock/temp files are allocated for previews.
    const output = await boundedProgram(store, ["api", "--hostname", repo.host, `repos/${repo.repo}`]);
    const metadata = JSON.parse(output);
    const visible = metadata.visibility ?? (metadata.private ? "private" : "public");
    destination = { ...repo, target: options.github.target ?? "auto", visibility: visible, allowed: visible !== "public" || options.github.allowPublic === true };
  }
  const preview: Decision = { id: "d-preview", workflow: "w-preview", execution: "x-preview", event: "e-preview", chain: "c-preview", hook: hook.name, route: "preview", status: "pending", question: resolveTemplate(options.question, { payload }, "none").value, choices: options.choices, snapshot, options, createdAt: "preview", expiresAt: "preview", publication: { status: "intent", marker: "<!-- preview -->" } };
  const content = await publicationBody(preview);
  return { destination, files: snapshot.files.map(({ path, hash, publish }) => ({ path, hash, publish })), truncated: content.truncated, bytes: Buffer.byteLength(content.body), effects: options.github ? ["create/reconcile workflow thread", "post checkpoint comment"] : ["save local checkpoint"], question: preview.question, choices: preview.choices };
}
export async function publishDecision(store: Store, decisionId: string): Promise<void> {
  return withGithubBudget(operationDeadline.getStore() ?? Date.now() + 15000, async () => {
  const token = id("publication");
  const prepared = await store.tx(async (tx) => {
    const decision = await tx.require("decisions", decisionId);
    if (!decision.publication || decision.publication.status === "published" || decision.status !== "pending") return undefined;
    const workflow = await tx.require("workflows", decision.workflow);
    const pubOwner = (workflow as typeof workflow & { publicationOwner?: Publication["owner"] }).publicationOwner;
    if (pubOwner && (!sameHost(pubOwner.host) || alive(pubOwner.pid))) return undefined;
    if (decision.publication.owner && (!sameHost(decision.publication.owner.host) || alive(decision.publication.owner.pid))) return undefined;
    decision.publication.owner = { ...owner(), token }; decision.publication.status = "publishing";
    (workflow as typeof workflow & { publicationOwner?: Publication["owner"] }).publicationOwner = { ...owner(), token };
    tx.put("workflows", workflow); tx.put("decisions", decision);
    return { decision, workflow, thread: await tx.get("threads", decision.workflow) };
  });
  if (!prepared) return;
  let failure: string | undefined;
  let destination: Publication["destination"];
  let approvers: Publication["approvers"];
  try {
    const { decision, workflow } = prepared;
    const options = decision.options.github!;
    const selected = repoParts(options.repo ?? githubRepository(workflow.sourceRemote ?? await git(decision.snapshot.workspace, ["remote", "get-url", "origin"])));
    const { host, repo } = selected;
    await visibility(store, host, repo, options.allowPublic);
    if (prepared.thread && (prepared.thread.repo !== repo || prepared.thread.host !== host)) throw new GithubError("Recorded thread repository differs from the authoritative destination; reissue explicitly.");
    approvers = decision.publication!.approvers;
    if (!approvers) {
      const accounts = options.approvers?.length ? options.approvers : [String((await api(store, host, "user") as { login: string }).login)];
      approvers = [];
      for (const login of accounts) { const user = await api(store, host, `users/${encodeURIComponent(login)}`) as { id: number; login: string }; if (!Number.isSafeInteger(user.id) || !user.login) throw new GithubError(`Cannot resolve stable account ID for ${login}.`); approvers.push({ id: user.id, login: user.login }); }
    }
    let thread = prepared.thread;
    if ((options.target ?? "auto") !== "issue") {
      const branch = await git(decision.snapshot.workspace, ["branch", "--show-current"]);
      // Same-repository PRs only; the head filter avoids paging every open PR.
      const head = `${repo.split("/")[0]}:${branch}`;
      const prs = branch ? await pages<{ number: number; html_url: string; head?: { ref?: string; repo?: { full_name?: string } } }>(store, host, `repos/${repo}/pulls?state=open&head=${encodeURIComponent(head)}`) : [];
      const pr = prs.find((p) => p.head?.ref === branch && (!p.head.repo?.full_name || p.head.repo.full_name.toLowerCase() === repo.toLowerCase()));
      if (pr) thread = { workflow: workflow.id, host, repo, number: pr.number, kind: "pr", url: pr.html_url };
      else if (options.target === "pr") throw new GithubError(`No matching open PR in authoritative ${host}/${repo}.`);
    }
    if (!thread) {
      const marker = `<!-- spec-lite-workflow:${workflow.id} -->`;
      // Reconciliation only covers an issue this account created whose response was lost, so it is
      // among this account's newest issues: search a few recent pages, never the whole repository.
      const login = String((await api(store, host, "user") as { login: string }).login);
      const existing = await findInPages<{ number: number; body?: string; html_url: string; pull_request?: unknown; user?: { login?: string } }>(store, host,
        `repos/${repo}/issues?state=all&creator=${encodeURIComponent(login)}&sort=created&direction=desc`, (issue) => !issue.pull_request && !!issue.body?.includes(marker) && (issue.user?.login ?? login) === login, 3);
      if (existing) thread = { workflow: workflow.id, host, repo, number: existing.number, kind: "issue", url: existing.html_url };
      else {
        await visibility(store, host, repo, options.allowPublic);
        const created = await api(store, host, `repos/${repo}/issues`, "POST", { title: `spec-lite workflow ${workflow.id}`, body: `${marker}\nWorkflow ${workflow.id}. Checkpoint answers require the exact decision ID.` }) as { number: number; html_url: string };
        if (!Number.isInteger(created.number)) throw new GithubError("GitHub issue response lacks its number; publication will reconcile by workflow marker.");
        thread = { workflow: workflow.id, host, repo, number: created.number, kind: "issue", url: created.html_url };
      }
    }
    destination = { host, repo, number: thread.number, kind: thread.kind, url: thread.url };
    // Save exact destination and stable identities before comment I/O. A lost post is reconciled by marker.
    await store.tx(async (tx) => { const current = await tx.require("decisions", decisionId); if (current.publication?.owner?.token !== token) throw new GithubError("Publication ownership changed."); current.publication.destination = destination; current.publication.approvers = approvers; tx.put("decisions", current); tx.put("threads", thread!); });
    const comments = await pages<GithubReply & { html_url?: string }>(store, host, `repos/${repo}/issues/${thread.number}/comments`);
    let posted = comments.find((comment) => comment.body.includes(decision.publication!.marker));
    if (!posted) {
      const { body } = await publicationBody(decision);
      await visibility(store, host, repo, options.allowPublic);
      posted = await api(store, host, `repos/${repo}/issues/${thread.number}/comments`, "POST", { body }) as GithubReply & { html_url?: string };
    }
    if (!Number.isSafeInteger(posted.id)) throw new GithubError("Comment response lacks an ID; retry reconciles by decision marker.");
    destination.comment = posted.id; destination.url = posted.html_url ?? thread.url;
  } catch (e) { failure = `${(e as Error).message} Local answer: spec-lite decide ${decisionId} <choice>. Retry publication with spec-lite next ${decisionId}.`; }
  await store.tx(async (tx) => {
    const d = await tx.require("decisions", decisionId); const w = await tx.require("workflows", d.workflow);
    if (d.publication?.owner?.token === token) { d.publication.owner = undefined; d.publication.status = failure ? "error" : "published"; d.publication.error = failure; d.publication.destination = destination ?? d.publication.destination; d.publication.approvers = approvers ?? d.publication.approvers; tx.put("decisions", d); }
    const mutable = w as typeof w & { publicationOwner?: Publication["owner"] }; if (mutable.publicationOwner?.token === token) { mutable.publicationOwner = undefined; tx.put("workflows", mutable); }
  });
  });
}
export function parseReply(body: string, decision: Decision): { choice: string; feedback: string } | undefined {
  const lines = body.split(/\r?\n/); const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0) return undefined;
  const matched = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)[\t ]+(d-[a-z0-9]+)(?:[\t ]+(.*))?$/i.exec(lines[first].trim());
  if (!matched || matched[2] !== decision.id || !Object.hasOwn(decision.choices, matched[1].toLowerCase())) return undefined;
  return { choice: matched[1].toLowerCase(), feedback: [matched[3] ?? "", ...lines.slice(first + 1)].join("\n").trim() };
}
export async function pollDecision(store: Store, decision: Decision): Promise<{ replies: GithubReply[]; error?: string }> {
  return withGithubBudget(operationDeadline.getStore() ?? Date.now() + 15000, async () => {
  const publication = decision.publication!; const destination = publication.destination!;
  const token = id("poll");
  const lease = await store.tx(async (tx) => {
    const d = await tx.require("decisions", decision.id);
    const state = d.publication as Publication & { pollOwner?: Publication["owner"]; nextPollAt?: number };
    if ((state.nextPollAt ?? 0) > Date.now() || (state.pollOwner && (!sameHost(state.pollOwner.host) || alive(state.pollOwner.pid)))) return false;
    state.pollOwner = { ...owner(), token }; tx.put("decisions", d); return true;
  });
  if (!lease) return { replies: [] };
  try {
    // Overlap update-time cursors; examined IDs are immutable even if their body later changes.
    const since = publication.cursor ? `?since=${encodeURIComponent(new Date(Math.max(0, Date.parse(publication.cursor) - 60000)).toISOString())}` : "";
    const replies = await pages<GithubReply>(store, destination.host, `repos/${destination.repo}/issues/${destination.number}/comments${since}`);
    const eligible = replies.filter((reply) => Number.isSafeInteger(reply.id) && reply.id > (destination.comment ?? Infinity) && !(publication.examined ?? []).includes(reply.id))
      .sort((a,b) => a.id - b.id).map((reply) => {
        const authorized = publication.approvers?.some((account) => account.id === reply.user?.id);
        // Ordering after the checkpoint comes from the comment ID boundary, not local clocks; only expiry is time-based.
        const eligibleTime = Date.parse(reply.created_at) < Date.parse(decision.expiresAt) && Date.now() < Date.parse(decision.expiresAt);
        const unedited = reply.updated_at === reply.created_at;
        const parsed = authorized && eligibleTime && unedited && reply.user.type !== "Bot" ? parseReply(reply.body, decision) : undefined;
        const firstLine = reply.body.trim().split(/\r?\n/)[0] ?? "";
        const namesDecision = /^\/\S+[\t ]+(d-[a-z0-9]+)(?:[\t ]|$)/i.exec(firstLine)?.[1] === decision.id;
        return { ...reply, ...parsed, rejected: !parsed && authorized && reply.user.type !== "Bot" && namesDecision };
      });
    await store.tx(async (tx) => { const d = await tx.require("decisions", decision.id); const p = d.publication as Publication & { pollOwner?: Publication["owner"]; nextPollAt?: number }; if (p.pollOwner?.token === token) { p.pollOwner = undefined; p.failures = 0; p.nextPollAt = Date.now() + (d.options.github?.pollSeconds ?? 30) * 1000; tx.put("decisions", d); } });
    return { replies: eligible };
  } catch (e) {
    await store.tx(async (tx) => { const d = await tx.require("decisions", decision.id); const p = d.publication as Publication & { pollOwner?: Publication["owner"]; nextPollAt?: number }; if (p.pollOwner?.token === token) { p.pollOwner = undefined; p.failures = (p.failures ?? 0) + 1; p.nextPollAt = Date.now() + Math.max(e instanceof GithubError ? e.retryAfter : 0, Math.min(300000, 1000 * 2 ** p.failures)); tx.put("decisions", d); } });
    return { replies: [], error: (e as Error).message };
  }
  });
}
/** Best-effort acknowledgment after persistence: +1 for an accepted answer, confused for a rejected one. */
export async function notifyReaction(store: Store, decisionId: string, commentId: number, content: "+1" | "confused" = "+1"): Promise<void> {
  try { const d = await store.tx((tx) => tx.require("decisions", decisionId)); const dest = d.publication!.destination!; await api(store, dest.host, `repos/${dest.repo}/issues/comments/${commentId}/reactions`, "POST", { content }); } catch { /* The answer state is already durable. */ }
}
