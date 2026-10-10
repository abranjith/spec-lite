/**
 * Workspace-relative path helpers for the hook system.
 */
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
  featureNumbersInText,
  normalizeFeatureId,
  parseFeatureDirectory,
} from "../utils/feature-id.js";

export function workspaceRoot(cwd = process.cwd()): string {
  return cwd;
}

export function hooksJsonPath(root: string): string {
  return path.join(root, ".spec-lite", "hooks.json");
}

/** The slice of `.spec-lite.json` the hook system reads. */
export interface HookRelevantConfig {
  /** Primary configured harness alias, e.g. "claude-code". */
  provider?: string;
  /** Every configured harness alias. */
  providers?: string[];
  hooks?: { enabled?: boolean };
}

/**
 * Read `.spec-lite.json`, or an empty object when it is absent or malformed.
 *
 * A malformed config is deliberately not an error here: it is the config
 * command's problem to report, and treating it as fatal would disable every
 * hook — or block every run — over a file the hook system only reads two keys
 * from.
 */
export async function readProjectConfig(root: string): Promise<HookRelevantConfig> {
  const file = path.join(root, ".spec-lite.json");
  if (!(await fs.pathExists(file))) return {};
  try {
    return (await fs.readJson(file)) as HookRelevantConfig;
  } catch {
    return {};
  }
}

/**
 * The harness alias to report as `${provider}`. Always resolves to something,
 * so a template referencing it never has to carry a `:-default`.
 */
export async function resolveProvider(root: string): Promise<string> {
  const config = await readProjectConfig(root);
  return config.provider ?? config.providers?.[0] ?? "unknown";
}

export function globalHooksJsonPath(): string {
  return path.join(os.homedir(), ".spec-lite", "hooks.json");
}

export function featuresDir(root: string): string {
  return path.join(root, ".spec-lite", "features");
}

export interface FeatureLocation {
  id: string;
  name: string;
  dir: string;
  spec: string;
}

/** Resolve a feature ID (e.g. "FEAT-012", legacy "FEAT-FP-007", or "12") to its directory. */
export async function resolveFeature(root: string, featureId: string): Promise<FeatureLocation | undefined> {
  const normalized = normalizeFeatureId(featureId);
  if (!normalized) return undefined;

  const dir = featuresDir(root);
  if (!(await fs.pathExists(dir))) return undefined;

  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    const feature = parseFeatureDirectory(entry);
    if (!feature || feature.id !== normalized) continue;
    const absDir = path.join(dir, entry);
    return {
      id: feature.id,
      name: feature.name,
      dir: path.relative(root, absDir).split(path.sep).join("/"),
      spec: path.relative(root, path.join(absDir, "spec.md")).split(path.sep).join("/"),
    };
  }
  return undefined;
}

export function changesetPath(root: string, featureDir: string): string {
  return path.join(root, featureDir, "changeset.json");
}

export function hooksLogPath(root: string, featureDir: string): string {
  return path.join(root, featureDir, "hooks.log.jsonl");
}

/** Highest supported feature-ID suffix in use, scanning feature dirs and plan tables. */
export async function nextFeatureNumber(root: string): Promise<number> {
  let max = 0;

  const dir = featuresDir(root);
  if (await fs.pathExists(dir)) {
    for (const entry of await fs.readdir(dir)) {
      const feature = parseFeatureDirectory(entry);
      if (feature) max = Math.max(max, feature.number);
    }
  }

  const specLiteDir = path.join(root, ".spec-lite");
  const planFiles = (await fs.readdir(specLiteDir).catch(() => [] as string[])).filter(
    (f) => /^plan.*\.md$/i.test(f)
  );
  for (const file of planFiles) {
    const content = await fs.readFile(path.join(specLiteDir, file), "utf-8").catch(() => "");
    for (const featureNumber of featureNumbersInText(content)) max = Math.max(max, featureNumber);
  }

  return max + 1;
}
