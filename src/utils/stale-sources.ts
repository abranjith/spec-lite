import path from "node:path";
import fs from "fs-extra";
import type { OutputScope, Provider, SourceItem } from "../providers/base.js";
import { extractOutputContext } from "./output-preservation.js";

export interface RemovedSource {
  internalName: string;
  promptName: string;
  agentName: string;
}

/** Sources removed or renamed in v0.2.0 and their historical output forms. */
export const REMOVED_SOURCES: RemovedSource[] = [
  {
    internalName: "review-code",
    promptName: "review_code",
    agentName: "code_reviewer",
  },
  {
    internalName: "review-security",
    promptName: "review_security",
    agentName: "security_reviewer",
  },
  {
    internalName: "review-performance",
    promptName: "review_performance",
    agentName: "performance_reviewer",
  },
  { internalName: "explore", promptName: "explore", agentName: "explorer" },
  {
    internalName: "write-readme",
    promptName: "write_readme",
    agentName: "readme_writer",
  },
];

function portable(value: string): string {
  return value.replace(/\\/g, "/");
}

function legacyFileNames(source: RemovedSource): Set<string> {
  return new Set([
    `spec.${source.promptName}.prompt.md`,
    `spec.${source.promptName}.md`,
    `spec.${source.promptName}.toml`,
    `spec.${source.agentName}.agent.md`,
    `spec.${source.agentName}.md`,
    `spec.${source.agentName}.toml`,
  ]);
}

function protectedOutputPaths(
  provider: Provider,
  sources: SourceItem[]
): Set<string> {
  const protectedPaths = new Set<string>();
  for (const source of sources) {
    if (provider.alias === "codex" && source.kind === "reference") continue;
    const paths = provider.getOutputPaths(source.name);
    if (paths.prompt) protectedPaths.add(portable(paths.prompt));
    if (paths.agent) protectedPaths.add(portable(paths.agent));
    // Pre-0.5.0 names of current sources are migrated by resolveLegacyRenames,
    // which carries their Project Context over before removing them.
    const legacy = provider.getLegacyOutputPaths?.(source.name, "project");
    if (legacy?.prompt) protectedPaths.add(portable(legacy.prompt));
    if (legacy?.agent) protectedPaths.add(portable(legacy.agent));
    if (
      source.kind === "skill" &&
      provider.supportsNativeSkills &&
      provider.getSkillOutputDir
    ) {
      protectedPaths.add(portable(provider.getSkillOutputDir(source.name)));
    }
  }
  return protectedPaths;
}

/** Resolve exact legacy files/directories that are present for one provider. */
export async function resolveStaleOutputPaths(
  workspaceRoot: string,
  provider: Provider,
  currentSources: SourceItem[]
): Promise<string[]> {
  const existing = await provider.detectExisting(workspaceRoot);
  const protectedPaths = protectedOutputPaths(provider, currentSources);
  const stale = new Set<string>();

  for (const existingPath of existing) {
    const normalized = portable(existingPath);
    for (const removed of REMOVED_SOURCES) {
      const nativeSkillDir = `spec-${removed.internalName}`;
      const segments = normalized.split("/");
      const skillIndex = segments.indexOf(nativeSkillDir);
      const candidate =
        skillIndex >= 0
          ? segments.slice(0, skillIndex + 1).join("/")
          : normalized;
      const isLegacy =
        skillIndex >= 0 ||
        legacyFileNames(removed).has(path.posix.basename(normalized));

      if (
        isLegacy &&
        !protectedPaths.has(candidate) &&
        !protectedPaths.has(normalized)
      ) {
        stale.add(candidate);
      }
    }
  }

  return [...stale].sort();
}

export interface LegacyRename {
  /** Pre-0.5.0 dotted path: relative to the workspace for project scope, absolute for global. */
  legacyPath: string;
  /** Path that replaces it, in the same form: an agent/prompt file or a native skill directory. */
  newPath: string;
  /** Project Context block from the legacy file, so it survives the rename. */
  contextBlock: string | null;
  /** Actual replacement file (newPath can be a native skill directory). */
  outputFile: string;
  /** Snapshot used to refuse cleanup if the original changes during migration. */
  originalContent: string;
}

/**
 * Find pre-0.5.0 `spec.<name>` outputs of the given sources that now live under
 * Agent Skills–compliant `spec-<name>` paths. Only files that exist are returned.
 */
export async function resolveLegacyRenames(
  workspaceRoot: string,
  provider: Provider,
  sources: SourceItem[],
  scope: OutputScope
): Promise<LegacyRename[]> {
  if (!provider.getLegacyOutputPaths) return [];
  const renames = new Map<string, LegacyRename>();

  for (const source of sources) {
    // Codex has no native primitive for prompt-only reference docs.
    if (provider.alias === "codex" && source.kind === "reference") continue;

    const legacy = provider.getLegacyOutputPaths(source.name, scope);
    const current =
      scope === "global"
        ? (provider.getGlobalOutputPaths?.(source.name) ?? {})
        : provider.getOutputPaths(source.name);
    const skillDir =
      scope === "global"
        ? provider.getGlobalSkillOutputDir?.(source.name)
        : provider.getSkillOutputDir?.(source.name);
    const isNativeSkill =
      source.kind === "skill" &&
      !!source.frontmatter &&
      provider.supportsNativeSkills &&
      !!skillDir;

    const pairs: Array<[string | undefined, string | undefined]> = [
      [legacy.agent, current.agent],
      [legacy.prompt, isNativeSkill ? skillDir : current.prompt],
    ];
    for (const [legacyPath, newPath] of pairs) {
      if (!legacyPath || !newPath || renames.has(legacyPath)) continue;
      const absolute =
        scope === "global" ? legacyPath : path.join(workspaceRoot, legacyPath);
      if (!(await fs.pathExists(absolute))) continue;
      const content = await fs.readFile(absolute, "utf-8");
      renames.set(legacyPath, {
        legacyPath,
        newPath,
        contextBlock: extractOutputContext(provider, content, absolute),
        outputFile:
          isNativeSkill && newPath === skillDir
            ? path.join(newPath, "SKILL.md")
            : newPath,
        originalContent: content,
      });
    }
  }

  return [...renames.values()].sort((a, b) =>
    a.legacyPath.localeCompare(b.legacyPath)
  );
}
