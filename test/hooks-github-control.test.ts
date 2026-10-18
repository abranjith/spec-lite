import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { runEvent } from "../src/hooks/runner.js";
import { next, decide } from "../src/hooks/control/engine.js";
import { Store } from "../src/hooks/control/store.js";
import {
  parseReply,
  publicationBody,
  type GithubReply,
} from "../src/hooks/control/github.js";
import { git } from "../src/hooks/builtins/git-workflow.js";
import type { ControlResult, Publication } from "../src/hooks/control/types.js";

// Like the other control suites: git setup plus stubbed gh calls exceed the 5s default under parallel load.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

type PollPublication = Publication & { nextPollAt?: number };
type GithubIssue = { number: number; body: string; html_url: string };
type GithubPr = {
  number: number;
  html_url: string;
  head: { ref: string; repo: { full_name: string } };
};

const channel = vi.hoisted(() => ({
  calls: [] as Array<{
    endpoint: string;
    method: string;
    body?: Record<string, string>;
    host?: string;
  }>,
  private: true,
  comments: [] as GithubReply[],
  issues: [] as GithubIssue[],
  prs: [] as GithubPr[],
  failPost: false,
  lostPost: false,
  failReaction: false,
  rateLimit: false,
  delay: 0,
}));
vi.mock("../src/hooks/builtins/git-workflow.js", async (original) => {
  const actual =
    await original<typeof import("../src/hooks/builtins/git-workflow.js")>();
  return {
    ...actual,
    runProgram: async (
      root: string,
      bin: string,
      args: string[],
      ...rest: [timeout?: number, env?: NodeJS.ProcessEnv]
    ) => {
      if (bin !== "gh") return actual.runProgram(root, bin, args, ...rest);
      const endpoint = args.find((arg) =>
        /^(repos\/|users\/|user$)/.test(arg)
      )!;
      const method = args.includes("--method")
        ? args[args.indexOf("--method") + 1]
        : "GET";
      const body = args.includes("--input")
        ? await fs.readJson(args[args.indexOf("--input") + 1])
        : undefined;
      channel.calls.push({
        endpoint,
        method,
        body,
        host: args[args.indexOf("--hostname") + 1],
      });
      if (channel.delay)
        await new Promise((resolve) => setTimeout(resolve, channel.delay));
      if (channel.rateLimit)
        throw Object.assign(new Error("gh failed"), {
          stdout: "HTTP/2.0 429\r\nRetry-After: 40\r\n\r\n{}",
        });
      if (endpoint === "user") return JSON.stringify({ id: 1, login: "owner" });
      if (endpoint.startsWith("users/"))
        return JSON.stringify({
          id: endpoint.endsWith("other") ? 2 : 1,
          login: endpoint.slice(6),
        });
      if (/^repos\/[^/]+\/[^/]+$/.test(endpoint))
        return JSON.stringify({
          private: channel.private,
          visibility: channel.private ? "private" : "public",
        });
      if (endpoint.includes("/reactions")) {
        if (channel.failReaction) throw new Error("reaction failure");
        return "{}";
      }
      if (endpoint.includes("/pulls?")) return JSON.stringify(channel.prs);
      if (/\/issues(?:\?|$)/.test(endpoint)) {
        if (method === "POST") {
          const created = {
            number: channel.issues.length + 1,
            body: body.body,
            html_url: "https://github.com/private/approvals/issues/1",
          };
          channel.issues.push(created);
          return JSON.stringify(created);
        }
        return JSON.stringify(channel.issues);
      }
      if (endpoint.includes("/comments")) {
        if (method === "POST") {
          if (channel.failPost) throw new Error("network down");
          const posted = {
            id: 100 + channel.comments.length,
            body: body.body,
            user: { id: 1, login: "owner" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            html_url:
              "https://github.com/private/approvals/issues/1#issuecomment-100",
          };
          channel.comments.push(posted);
          if (channel.lostPost) {
            channel.lostPost = false;
            throw new Error("lost response after durable server post");
          }
          return JSON.stringify(posted);
        }
        const page = Number(/[?&]page=(\d+)/.exec(endpoint)?.[1] ?? 1);
        return JSON.stringify(
          channel.comments.slice((page - 1) * 100, page * 100)
        );
      }
      throw new Error(`Unhandled gh stub ${endpoint}`);
    },
  };
});
let root: string;
beforeEach(async () => {
  channel.calls = [];
  channel.private = true;
  channel.comments = [];
  channel.issues = [];
  channel.prs = [];
  channel.failPost = false;
  channel.lostPost = false;
  channel.failReaction = false;
  channel.rateLimit = false;
  channel.delay = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-github-control-"));
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
  await fs.outputFile(
    path.join(root, ".spec-lite/plan.md"),
    "<script>alert('x')</script>\n"
  );
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "initial"]);
  await git(root, [
    "remote",
    "add",
    "origin",
    "https://github.com/public/source.git",
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.remove(root);
});
async function checkpoint(
  github: Record<string, unknown> = {
    target: "issue",
    repo: "private/approvals",
  },
  attach = ["${plan.file}"]
): Promise<ControlResult> {
  await fs.outputJson(path.join(root, ".spec-lite/hooks.json"), {
    version: 1,
    hooks: [
      { name: "capture-baseline", enabled: false },
      { name: "capture-changeset", enabled: false },
      {
        name: "ask",
        type: "builtin",
        builtin: "checkpoint",
        events: ["plan.post"],
        options: {
          question: "Review the plan",
          attach,
          choices: {
            review: { description: "Run critic", skill: "plan-critic" },
            stop: { description: "Stop", stop: true },
          },
          github,
        },
      },
    ],
  });
  const pre = (await runEvent({
    root,
    event: "plan.pre",
    protocol: 2,
    extra: { plan: ".spec-lite/plan.md" },
  })) as unknown as ControlResult;
  return (await runEvent({
    root,
    event: "plan.post",
    protocol: 2,
    execution: pre.executionId,
    extra: { plan: ".spec-lite/plan.md" },
  })) as unknown as ControlResult;
}
const reply = (
  id: number,
  body: string,
  user = { id: 1, login: "owner" },
  extra = {}
) => {
  const time = new Date().toISOString();
  return { id, body, user, created_at: time, updated_at: time, ...extra };
};

describe("GitHub channel destination and privacy", () => {
  it("uses the authoritative repo and explicit escaped attachments", async () => {
    const question = await checkpoint();
    expect(question.status).toBe("pending");
    expect(question.decision?.publication?.status).toBe("published");
    expect(
      channel.calls
        .filter((c) => c.endpoint.startsWith("repos/"))
        .every((c) => c.endpoint.startsWith("repos/private/approvals"))
    ).toBe(true);
    const body = channel.calls.find(
      (c) => c.endpoint.endsWith("/comments") && c.method === "POST"
    )!.body.body;
    expect(body).toContain("&lt;script&gt;");
    expect(body).not.toContain("<script>");
    expect(body).toContain(question.decisionId);
    expect(body).toContain("SHA-256");
  });
  it("preserves a local pending question on network or public-visibility failure", async () => {
    channel.private = false;
    const question = await checkpoint();
    expect(question.status).toBe("pending");
    expect(question.decision?.publication?.error).toContain("allowPublic");
    expect(channel.calls.some((c) => c.method === "POST")).toBe(false);
    const local = await decide(root, question.decisionId!, "stop");
    expect(local.status, JSON.stringify(local.error)).toBe("ready");
  });
  it("reconciles a lost comment response before retrying publication", async () => {
    channel.lostPost = true;
    const question = await checkpoint();
    expect(question.decision?.publication?.status).toBe("error");
    const repeated = await next(root, question.decisionId!);
    expect(repeated.decision?.publication?.status).toBe("published");
    expect(channel.comments).toHaveLength(1);
    expect(channel.issues).toHaveLength(1);
  });
  it("keeps private override when auto migrates to its matching PR", async () => {
    const first = await checkpoint({
      repo: "private/approvals",
      target: "auto",
    });
    expect(first.decision?.publication?.destination?.kind).toBe("issue");
    const store = await Store.open(root);
    const branch = await git(root, ["branch", "--show-current"]);
    channel.prs = [
      {
        number: 7,
        html_url: "https://github.com/private/approvals/pull/7",
        head: { ref: branch, repo: { full_name: "private/approvals" } },
      },
    ];
    const { manageDecision } = await import("../src/hooks/control/engine.js");
    const reissued = await manageDecision(
      root,
      first.decisionId!,
      "reissue",
      "User asks again on new PR"
    );
    const current = await store.tx((tx) =>
      tx.require("decisions", reissued.decisionId!)
    );
    expect(current.publication?.destination).toMatchObject({
      repo: "private/approvals",
      kind: "pr",
      number: 7,
    });
    expect(
      channel.calls
        .filter((c) => c.endpoint.startsWith("repos/"))
        .every((c) => c.endpoint.startsWith("repos/private/approvals"))
    ).toBe(true);
  });
  it("budgets all UTF-8 bytes and refuses changed attachment publication", async () => {
    const question = await checkpoint();
    const decision = question.decision!;
    await fs.writeFile(
      path.join(root, ".spec-lite/plan.md"),
      "新".repeat(70000)
    );
    await expect(publicationBody(decision)).rejects.toThrow("changed");
    decision.snapshot.files[0].hash = (
      await import("../src/hooks/control/store.js")
    ).hash(await fs.readFile(path.join(root, ".spec-lite/plan.md")));
    const output = await publicationBody(decision);
    expect(Buffer.byteLength(output.body)).toBeLessThanOrEqual(48 * 1024);
    expect(output.truncated).toHaveLength(1);
    decision.question = "q".repeat(50 * 1024);
    await expect(publicationBody(decision)).rejects.toThrow("48 KiB");
  });
});
describe("reply correlation, pagination and acceptance", () => {
  it("parses exact token and decision ID on the first nonempty line", async () => {
    const question = await checkpoint();
    const decision = question.decision!;
    expect(
      parseReply(`\n /REVIEW ${decision.id} feedback\nmore`, decision)
    ).toEqual({ choice: "review", feedback: "feedback\nmore" });
    for (const value of [
      `/review-extra ${decision.id}`,
      `/review d-wrong`,
      `other\n/review ${decision.id}`,
      `/review ${decision.id}-extra`,
    ])
      expect(parseReply(value, decision)).toBeUndefined();
  });
  it("fetches all pages and rejects edited/unauthorized/old inputs without consuming delivery", async () => {
    const question = await checkpoint();
    channel.comments.push(
      ...Array.from({ length: 100 }, (_, index) =>
        reply(200 + index, `/review ${question.decisionId}`, {
          id: 99,
          login: "stranger",
        })
      )
    );
    channel.comments.push(
      reply(
        400,
        `/review ${question.decisionId}`,
        { id: 1, login: "owner" },
        { updated_at: "2099-01-01T00:00:00Z" }
      )
    );
    channel.comments.push(reply(401, "/review d-old"));
    channel.comments.push(
      reply(402, `/review ${question.decisionId} scoped feedback`)
    );
    channel.failReaction = true;
    const selected = await next(root, question.decisionId!);
    expect(selected.status, JSON.stringify(selected.error)).toBe("ready");
    expect(selected.decision?.answer?.source).toBe("github");
    expect(selected.decision?.answer?.remote).toMatchObject({ id: 402 });
    expect(channel.calls.some((c) => c.endpoint.includes("page=2"))).toBe(true);
    const again = await next(root, question.decisionId!);
    expect(again.actionId).toBe(selected.actionId);
    expect(again.action?.owner).toBeUndefined();
    expect((await decide(root, question.decisionId!, "stop")).exitCode).toBe(1);
  });
  it("does not reinterpret an examined typo after an edit, and local answers win atomically", async () => {
    const question = await checkpoint();
    channel.comments.push(reply(201, `/typo ${question.decisionId}`));
    expect((await next(root, question.decisionId!)).status).toBe("pending");
    channel.comments[1].body = `/review ${question.decisionId}`;
    const store = await Store.open(root);
    await store.tx(async (tx) => {
      const d = await tx.require("decisions", question.decisionId!);
      (d.publication as PollPublication).nextPollAt = 0;
      tx.put("decisions", d);
    });
    expect((await next(root, question.decisionId!)).status).toBe("pending");
    expect((await decide(root, question.decisionId!, "stop")).status).toBe(
      "ready"
    );
    channel.comments.push(reply(202, `/review ${question.decisionId}`));
    expect(
      (await next(root, question.decisionId!)).decision?.answer?.choice
    ).toBe("stop");
  });
  it("stops bounded waiting on network/rate failure and honors Retry-After", async () => {
    const question = await checkpoint();
    channel.rateLimit = true;
    const outcome = await next(root, question.decisionId!, "1s");
    expect(outcome.error?.code).toBe("github-poll");
    const store = await Store.open(root);
    const d = await store.tx((tx) =>
      tx.require("decisions", question.decisionId!)
    );
    expect((d.publication as PollPublication).nextPollAt).toBeGreaterThan(
      Date.now() + 35000
    );
    expect(d.status).toBe("pending");
  });
  it("collects remote answers from plain next without starting the action", async () => {
    const question = await checkpoint();
    channel.comments.push(reply(201, `/review ${question.decisionId}`));
    const listing = await next(root);
    const saved = listing.items?.find((item) => item.actionId);
    expect(saved?.status).toBe("ready");
    expect(saved?.action?.owner).toBeUndefined();
  });
  it("accepts a reply despite local clock skew; ordering comes from comment IDs (REV-009)", async () => {
    const question = await checkpoint();
    const early = new Date(Date.now() - 10 * 60000).toISOString();
    channel.comments.push(
      reply(
        201,
        `/review ${question.decisionId}`,
        { id: 1, login: "owner" },
        { created_at: early, updated_at: early }
      )
    );
    expect((await next(root, question.decisionId!)).status).toBe("ready");
  });
  it("reacts once to an approver command that names the decision but cannot answer it (REV-010)", async () => {
    const question = await checkpoint();
    channel.comments.push(
      reply(201, `/critque ${question.decisionId}`),
      reply(202, "/review d-someotherdecision"),
      reply(203, `/review ${question.decisionId}`, {
        id: 99,
        login: "stranger",
      })
    );
    expect((await next(root, question.decisionId!)).status).toBe("pending");
    const reactions = channel.calls.filter((c) =>
      c.endpoint.includes("/reactions")
    );
    expect(reactions).toHaveLength(1);
    expect(reactions[0].endpoint).toContain("/comments/201/");
    expect(reactions[0].body.content).toBe("confused");
    const store = await Store.open(root);
    await store.tx(async (tx) => {
      const d = await tx.require("decisions", question.decisionId!);
      (d.publication as PollPublication).nextPollAt = 0;
      tx.put("decisions", d);
    });
    await next(root, question.decisionId!);
    expect(
      channel.calls.filter((c) => c.endpoint.includes("/reactions"))
    ).toHaveLength(1);
  });
  it("looks up PRs by branch and workflow issues by creator, never paging the whole repository (REV-004)", async () => {
    await checkpoint({ target: "auto", repo: "private/approvals" });
    const lookups = channel.calls.filter(
      (c) => c.method === "GET" && /\/(pulls|issues)\?/.test(c.endpoint)
    );
    const prs = lookups.filter((c) => c.endpoint.includes("/pulls?"));
    const issues = lookups.filter((c) => /\/issues\?/.test(c.endpoint));
    expect(prs.length).toBeGreaterThan(0);
    expect(prs.every((c) => c.endpoint.includes("head=private%3A"))).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    expect(
      issues.every(
        (c) =>
          c.endpoint.includes("creator=owner") &&
          c.endpoint.includes("direction=desc")
      )
    ).toBe(true);
  });
  it("bounds the HTTP call by the wait deadline", async () => {
    const question = await checkpoint();
    channel.delay = 1000;
    const start = Date.now();
    const inspected = await next(root, question.decisionId!, "100ms");
    expect(inspected.status).toBe("pending");
    expect(inspected.wait).toBe("timeout");
    expect(Date.now() - start).toBeLessThan(700);
    channel.delay = 0;
  });
});
