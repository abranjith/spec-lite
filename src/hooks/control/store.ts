/** Short, clone-wide transactions. A durable redo journal closes multi-record crash windows. */
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fs from "fs-extra";
import { repository, git } from "../builtins/git-workflow.js";
import { ControlError, type Records } from "./types.js";

export const id = (prefix: string) => `${prefix}-${crypto.randomBytes(10).toString("hex")}`;
export const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
export const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
export const sameHost = (host: string) => host === os.hostname();
export const owner = () => ({ pid: process.pid, host: os.hostname() });
export async function atomic(file: string, value: unknown): Promise<void> {
  await fs.ensureDir(path.dirname(file), { mode: 0o700 });
  const temp = `${file}.${id("write")}.tmp`;
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    try { await fs.writeFile(handle, JSON.stringify(value, null, 2)); await fs.fsync(handle); } finally { await fs.close(handle); }
    await fs.rename(temp, file);
  } finally { await fs.remove(temp); }
}

type Write = { file: string; value: unknown; text?: boolean };
export async function atomicText(file: string, value: string): Promise<void> {
  await fs.ensureDir(path.dirname(file), { mode: 0o700 });
  const temporary = `${file}.${id("write")}.tmp`;
  try { const handle = await fs.open(temporary, "wx", 0o600); try { await fs.writeFile(handle, value); await fs.fsync(handle); } finally { await fs.close(handle); } await fs.rename(temporary, file); }
  finally { await fs.remove(temporary); }
}
/** Publish a complete owner record atomically, with exclusive-create semantics. */
async function exclusiveOwner(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${id("owner")}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await fs.writeFile(handle, JSON.stringify(value)); await fs.fsync(handle); } finally { await fs.close(handle); }
    try { await fs.link(temporary, file); }
    catch (e) {
      if (!["EPERM", "ENOTSUP", "ENOSYS", "EOPNOTSUPP"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
      // Filesystems without hard links (exFAT, some mounts): exclusive create. A torn record reads as busy, never as free.
      const handle = await fs.open(file, "wx", 0o600);
      try { await fs.writeFile(handle, JSON.stringify(value)); await fs.fsync(handle); } finally { await fs.close(handle); }
    }
  } finally { await fs.remove(temporary); }
}
export class Transaction {
  private writes = new Map<string, Write>();
  constructor(readonly store: Store) {}
  async get<K extends keyof Records>(kind: K, key: string): Promise<Records[K] | undefined> {
    const file = this.store.file(kind, key);
    const staged = this.writes.get(file);
    if (staged) return structuredClone(staged.value as Records[K]);
    try { return await fs.readJson(file) as Records[K]; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new ControlError("corrupt-state", `Cannot read ${file}: ${(e as Error).message}`); }
  }
  async require<K extends keyof Records>(kind: K, key: string): Promise<Records[K]> {
    const found = await this.get(kind, key);
    if (!found) throw new ControlError("unknown-id", `Unknown ${kind} ID ${key}.`, 1, "spec-lite next");
    return found;
  }
  put<K extends keyof Records>(kind: K, value: Records[K]): void {
    const key = kind === "threads" ? (value as Records["threads"]).workflow : (value as { id: string }).id;
    const file = this.store.file(kind, key);
    this.writes.set(file, { file, value: structuredClone(value) });
  }
  file(file: string, value: string): void { this.writes.set(file, { file, value, text: true }); }
  async list<K extends keyof Records>(kind: K): Promise<Records[K][]> {
    const directory = path.join(this.store.root, kind);
    const entries = await fs.readdir(directory).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
    const keys = new Set(entries.filter((entry) => kind === "decisions" ? /^[a-z0-9-]+$/.test(entry) : /^[a-z0-9-]+\.json$/.test(entry)).map((entry) => kind === "decisions" ? entry : entry.replace(/\.json$/, "")));
    for (const write of this.writes.values()) if (path.relative(directory, write.file).split(path.sep).length === (kind === "decisions" ? 2 : 1)) {
      const relative = path.relative(directory, write.file);
      if (!relative.startsWith("..")) keys.add(kind === "decisions" ? relative.split(path.sep)[0] : relative.replace(/\.json$/, ""));
    }
    const values: Records[K][] = [];
    for (const key of keys) { const value = await this.get(kind, key); if (value) values.push(value); }
    return values;
  }
  async commit(): Promise<void> {
    if (!this.writes.size) return;
    const writes = [...this.writes.values()];
    const journal = path.join(this.store.root, "intent.json");
    await atomic(journal, writes);
    for (const write of writes) if (write.text) await atomicText(write.file, String(write.value)); else await atomic(write.file, write.value);
    await fs.remove(journal);
  }
}
export class Store {
  constructor(readonly root: string, readonly workspace: string) {}
  static async open(workspace: string): Promise<Store> {
    const repo = await repository(workspace).catch((e) => { throw new ControlError("git-required", `Durable hooks require a non-bare Git checkout: ${(e as Error).message}`); });
    const top = await git(workspace, ["rev-parse", "--show-toplevel"]);
    return new Store(path.join(repo.commonDir, "spec-lite"), await fs.realpath(top));
  }
  file(kind: keyof Records, key: string): string {
    if (!/^[a-z0-9-]+$/.test(key)) throw new ControlError("invalid-id", `Invalid ${kind} ID ${key}.`, 2);
    return kind === "decisions" ? path.join(this.root, kind, key, "decision.json") : path.join(this.root, kind, `${key}.json`);
  }
  feedback(key: string): string { return path.join(path.dirname(this.file("decisions", key)), "feedback.md"); }
  async tx<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
    const directory = path.join(this.root, "locks");
    await fs.ensureDir(directory, { mode: 0o700 });
    const lock = path.join(directory, "control.lock");
    const token = id("lock");
    let acquired = false;
    // About 3s of jittered backoff: parallel delegates contend briefly; a live long holder still reports busy.
    const delays = [20, 40, 80, 120, 200, 300, 400, 500, 600, 700];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try { await exclusiveOwner(lock, { ...owner(), token }); acquired = true; break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const holder = await fs.readJson(lock).catch(() => undefined);
        if (holder && sameHost(holder.host) && !alive(holder.pid)) {
          const reaper = `${lock}.reaping`;
          let reclaim = false;
          try { await exclusiveOwner(reaper, { ...owner(), token }); reclaim = true; }
          catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            const reapingOwner = await fs.readJson(reaper).catch(() => undefined);
            if (!reapingOwner || (sameHost(reapingOwner.host) && !alive(reapingOwner.pid))) throw new ControlError("stale-reaper", `Stale or unreadable lock recovery owner at ${reaper}.`, 4, `Stop all spec-lite processes, inspect ${reaper}, remove only this stale recovery lock, then retry. Unknown/live owners must never be removed automatically.`);
          }
          if (reclaim) {
            try { const current = await fs.readJson(lock).catch(() => undefined); if (current?.token === holder.token && current?.pid === holder.pid && sameHost(current.host) && !alive(current.pid)) await fs.remove(lock); }
            finally { await fs.remove(reaper); }
            continue;
          }
        }
        if (attempt < delays.length) await new Promise((resolve) => setTimeout(resolve, delays[attempt] + Math.floor(Math.random() * 20)));
      }
    }
    if (!acquired) throw new ControlError("busy", `Runtime state is busy; no ownership was changed. Lock: ${lock}`, 4, `Retry the same command. If the owner record is unreadable, stop all spec-lite processes and inspect ${lock}; only explicitly remove a proven orphan.`);
    try {
      const journal = path.join(this.root, "intent.json");
      if (await fs.pathExists(journal)) {
        const writes = await fs.readJson(journal) as Write[];
        for (const write of writes) {
          const relative = path.relative(this.root, write.file);
          if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ControlError("corrupt-intent", "Transaction journal contains an external path.");
          if (write.text) await atomicText(write.file, String(write.value)); else await atomic(write.file, write.value);
        }
        await fs.remove(journal);
      }
      const transaction = new Transaction(this);
      const result = await fn(transaction);
      await transaction.commit();
      return result;
    } finally {
      const holder = await fs.readJson(lock).catch(() => undefined);
      if (holder?.token === token) await fs.remove(lock);
    }
  }
  /** Temp files are unique, never read as a prior response; abandoned files expire locally. */
  async temp(suffix: string): Promise<string> {
    const directory = path.join(this.root, "tmp");
    await fs.ensureDir(directory, { mode: 0o700 });
    for (const entry of (await fs.readdir(directory)).slice(0, 200)) {
      const file = path.join(directory, entry);
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > 24 * 3600000) await fs.remove(file);
    }
    return path.join(directory, `${id("tmp")}.${suffix}`);
  }
}
