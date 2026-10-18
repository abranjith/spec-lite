import type { HookPayload, HookResult, ResolvedHook } from "../types.js";

export type ControlStatus =
  | "continue"
  | "pending"
  | "ready"
  | "started"
  | "blocked"
  | "stopped"
  | "running"
  | "completed"
  | "interrupted"
  | "expired"
  | "cancelled"
  | "superseded"
  | "paused"
  | "error";
export interface Choice {
  description: string;
  skill?: string;
  agent?: string;
  prompt?: string;
  args?: string;
  continue?: true;
  stop?: true;
  completion?: "reported";
}
export interface GithubOptions {
  target?: "auto" | "issue" | "pr";
  repo?: string;
  approvers?: string[];
  allowPublic?: boolean;
  pollSeconds?: number;
}
export interface CheckpointOptions {
  question: string;
  choices: Record<string, Choice>;
  attach?: string[];
  inputs?: string[];
  rules?: Array<{ if: Record<string, string>; choose: string }>;
  github?: GithubOptions;
  expiresIn?: string;
  afterEffects?: boolean;
}
export interface Recovery {
  source: "local-session";
  reason: string;
  at: string;
  generation: number;
  mode: string;
  checks?: string[];
}
export interface Workflow {
  id: string;
  key: string;
  kind: string;
  scope: string;
  workspace: string;
  parent?: string;
  sourceRemote?: string;
  barrier?: string;
  createdAt: string;
}
export interface Execution {
  id: string;
  workflow: string;
  role: string;
  workspace: string;
  parent?: string;
  action?: string;
  chain: string;
  generation: number;
  status: "running" | "completed" | "stopped" | "replaced" | "interrupted";
  createdAt: string;
  payload: HookPayload;
  events: Record<string, string>;
  bodyProduced?: boolean;
  recoveries?: Recovery[];
}
export interface Chain {
  id: string;
  hops: number;
  routes: string[];
  checkpointRoutes: string[];
  max: number;
}
export interface EventRecord {
  id: string;
  workflow: string;
  execution: string;
  chain: string;
  name: string;
  key: string;
  generation: number;
  status:
    | "running"
    | "blocked"
    | "pending"
    | "completed"
    | "replaced"
    | "stopped"
    | "interrupted"
    | "paused";
  position: "before-body" | "after-body" | "signal";
  cursor: number;
  hooks: ResolvedHook[];
  payload: HookPayload;
  rounds: number;
  maxRounds: number;
  episode: number;
  effects: Array<{ hook: string; status: string }>;
  outcomes: HookResult[];
  inFlight?: { hook: string; repeatable: boolean; pid: number; host: string };
  decision?: string;
  action?: string;
  overrides: string[];
  recoveries: Recovery[];
  result?: ControlResult;
}
export interface FileSnapshot {
  path: string;
  realPath: string;
  hash: string;
  missing?: boolean;
  publish?: boolean;
  withheld?: boolean;
}
export interface TargetIdentity {
  logical: string;
  kind: "skill" | "agent" | "prompt";
  canonical: string;
  effective: Record<string, string>;
  completion: "lifecycle" | "reported";
}
export interface Snapshot {
  workspace: string;
  hook: ResolvedHook;
  registryHash: string;
  files: FileSnapshot[];
  targets: Record<string, TargetIdentity>;
  payload: HookPayload;
}
export interface Publication {
  status: "intent" | "publishing" | "published" | "error";
  marker: string;
  owner?: { pid: number; host: string; token: string };
  destination?: {
    host: string;
    repo: string;
    number: number;
    kind: "issue" | "pr";
    comment?: number;
    url?: string;
  };
  approvers?: Array<{ id: number; login: string }>;
  error?: string;
  examined?: number[];
  cursor?: string;
  failures?: number;
}
export interface Decision {
  id: string;
  workflow: string;
  execution: string;
  event: string;
  chain: string;
  hook: string;
  route: string;
  status: "pending" | "answered" | "expired" | "cancelled" | "superseded";
  question: string;
  choices: Record<string, Choice>;
  createdAt: string;
  expiresAt: string;
  snapshot: Snapshot;
  options: CheckpointOptions;
  action?: string;
  previous?: string;
  answer?: {
    choice: string;
    actor: string;
    source: "local-session" | "github" | "rule";
    at: string;
    feedback: string;
    remote?: unknown;
    rule?: unknown;
  };
  publication?: Publication;
  reason?: string;
  signals?: Record<string, "intent" | "sending" | "sent" | "uncertain">;
}
export interface Action {
  id: string;
  workflow: string;
  execution: string;
  event: string;
  chain: string;
  parent?: string;
  hook: string;
  route: string;
  status:
    | "ready"
    | "running"
    | "completed"
    | "stopped"
    | "failed"
    | "interrupted"
    | "cancelled"
    | "superseded";
  choice: Choice;
  decision?: string;
  target?: TargetIdentity;
  snapshot: Snapshot;
  generation: number;
  owner?: { execution: string; generation: number };
  recoveries: Recovery[];
  history: Array<unknown>;
  outcome?: string;
}
export interface Thread {
  workflow: string;
  repo: string;
  host: string;
  number: number;
  kind: "issue" | "pr";
  url?: string;
}
export interface Records {
  workflows: Workflow;
  executions: Execution;
  events: EventRecord;
  decisions: Decision;
  actions: Action;
  chains: Chain;
  threads: Thread;
}
export interface ControlResult {
  protocol: 2;
  status: ControlStatus;
  exitCode: 0 | 1 | 2 | 3 | 4;
  workflowId?: string;
  executionId?: string;
  eventId?: string;
  actionId?: string;
  decisionId?: string;
  context?: {
    workspace: string;
    role: string;
    generation: number;
    chain: string;
    parent?: string;
  };
  continuation?: {
    execution: string;
    event: string;
    position: string;
    cursor: number;
    cancelledSuffix?: string[];
  };
  payload?: HookPayload;
  results: HookResult[];
  registryIssues: string[];
  effects?: EventRecord["effects"];
  decision?: Decision;
  action?: Action;
  startCommand?: string;
  recovery?: string;
  retryAllowed?: boolean;
  wait?: "timeout";
  error?: { code: string; message: string; recovery?: string };
  message?: string;
  items?: ControlResult[];
}
export class ControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: 1 | 2 | 4 = 1,
    readonly recovery?: string
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
