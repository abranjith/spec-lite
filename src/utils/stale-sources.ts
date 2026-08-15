import path from "node:path";
import type { Provider, SourceItem } from "../providers/base.js";

export interface RemovedSource {
  internalName: string;
  promptName: string;
  agentName: string;
}

/** Sources removed or renamed in v0.2.0 and their historical output forms. */
export const REMOVED_SOURCES: RemovedSource[] = [
  { internalName: "review-code", promptName: "review_code", agentName: "code_reviewer" },
  { internalName: "review-security", promptName: "review_security", agentName: "security_reviewer" },
  { internalName: "review-performance", promptName: "review_performance", agentName: "performance_reviewer" },
  { internalName: "explore", promptName: "explore", agentName: "explorer" },
  { internalName: "write-readme", promptName: "write_readme", agentName: "readme_writer" },
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

function protectedOutputPaths(provider: Provider, sources: SourceItem[]): Set<string> {
  const protectedPaths = new Set<string>();
  for (const source of sources) {
    if (provider.alias === "codex" && source.kind === "reference") continue;
    const paths = provider.getOutputPaths(source.name);
    if (paths.prompt) protectedPaths.add(portable(paths.prompt));
    if (paths.agent) protectedPaths.add(portable(paths.agent));
    if (source.kind === "skill" && provider.supportsNativeSkills && provider.getSkillOutputDir) {
      protectedPaths.add(portable(provider.getSkillOutputDir(source.name)));
    }
  }
  return protectedPaths;
}

/** Resolve exact legacy files/directories that are present for one provider. */
export async function resolveStaleOutputPaths(
  workspaceRoot: string,
  provider: Provider,
  currentSources: SourceItem[],
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
      const candidate = skillIndex >= 0
        ? segments.slice(0, skillIndex + 1).join("/")
        : normalized;
      const isLegacy =
        skillIndex >= 0 || legacyFileNames(removed).has(path.posix.basename(normalized));

      if (isLegacy && !protectedPaths.has(candidate) && !protectedPaths.has(normalized)) {
        stale.add(candidate);
      }
    }
  }

  return [...stale].sort();
}
