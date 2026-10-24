import path from "path";
import os from "os";
import fs from "fs-extra";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { Provider, PromptMeta, OutputScope } from "./base.js";
import {
  getAgentOutputName,
  getPromptOutputName,
  hasPromptName,
  isPromptOnly,
} from "../utils/prompts.js";
import { hasSpecPrefix, legacySpecName, toSpecName } from "../utils/naming.js";
import { detectHarnessMarkers } from "../utils/harness-detection.js";

/**
 * OpenAI Codex provider.
 *
 * Codex's native primitives (per developers.openai.com/codex):
 *  - `AGENTS.md` at the repo root and at `~/.codex/AGENTS.md` for global context.
 *  - Custom subagents: standalone TOML files in `.codex/agents/` (project) or
 *    `~/.codex/agents/` (global). Required fields: `name`, `description`,
 *    `developer_instructions`.
 *  - Custom skills: directories in `.agents/skills/` (project) or
 *    `~/.agents/skills/` (global) with a `SKILL.md` plus optional
 *    `references/`, `assets/`, `scripts/` subdirectories.
 *
 * Strategy:
 *  - Source agents → TOML subagents at `.codex/agents/spec-<agentName>.toml`
 *    (noun-form). The full markdown body is embedded in `developer_instructions`.
 *  - Source skills → `.agents/skills/spec-<name>/SKILL.md` (native Agent Skills).
 *  - Reference items (help, orchestrator) are skipped — Codex has no
 *    matching primitive for prompt-only docs.
 *  - A managed `AGENTS.md` is written at the project root for local installs
 *    and at `~/.codex/AGENTS.md` for global installs. It references the
 *    installed subagents and skills.
 */
export class CodexProvider implements Provider {
  name = "OpenAI Codex";
  alias = "codex";
  description =
    "OpenAI Codex (AGENTS.md + .codex/agents subagents + .agents/skills)";
  /**
   * Codex's "agents" are TOML files routed through the prompt path so we can
   * skip writing a separate markdown file. `supportsAgents = false` keeps the
   * shared init/install/update flow from emitting an agent file in addition.
   */
  supportsAgents = false;
  supportsNativeSkills = true;
  supportsGlobal = true;

  readOutputContent(content: string, outputPath: string): string {
    if (!outputPath.endsWith(".toml")) return content;
    const instructions = parseToml(content).developer_instructions;
    if (typeof instructions !== "string") {
      throw new Error(`Missing developer_instructions in ${outputPath}`);
    }
    return instructions;
  }

  getOutputPaths(promptName: string): { prompt: string } {
    return {
      prompt: path.join(
        ".codex",
        "agents",
        `${toSpecName(subagentFileName(promptName))}.toml`
      ),
    };
  }

  getGlobalOutputPaths(promptName: string): { prompt: string } {
    return {
      prompt: path.join(
        os.homedir(),
        ".codex",
        "agents",
        `${toSpecName(subagentFileName(promptName))}.toml`
      ),
    };
  }

  getLegacyOutputPaths(
    promptName: string,
    scope: OutputScope
  ): { prompt: string } {
    const root =
      scope === "global" ? path.join(os.homedir(), ".codex") : ".codex";
    return {
      prompt: path.join(
        root,
        "agents",
        `${legacySpecName(subagentFileName(promptName))}.toml`
      ),
    };
  }

  getSkillOutputDir(skillName: string): string {
    return path.join(".agents", "skills", toSpecName(skillName));
  }

  getGlobalSkillOutputDir(skillName: string): string {
    const homeDir = os.homedir();
    return path.join(homeDir, ".agents", "skills", toSpecName(skillName));
  }

  /**
   * Render the source content as a Codex subagent TOML file.
   *
   * Codex requires `name`, `description`, and `developer_instructions`. The
   * full markdown body (including the `<!-- project-context -->` block) is
   * serialized as `developer_instructions`. Updates decode its Markdown,
   * merge editable context, then serialize again to preserve TOML escaping.
   */
  transformPrompt(content: string, meta: PromptMeta): string {
    const subagentName = toSpecName(subagentFileName(meta.name));
    const lines = [
      `# spec-lite | ${meta.name}`,
      `# DO NOT EDIT below the project-context block — managed by spec-lite`,
      `# To update: run "spec-lite update" — your Project Context edits will be preserved`,
      "",
      stringifyToml({
        name: subagentName,
        description: meta.description || meta.title,
        developer_instructions: content,
      }),
    ];
    return lines.join("\n");
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];

    // Subagent TOML files in .codex/agents/
    const agentsDir = path.join(workspaceRoot, ".codex", "agents");
    if (await fs.pathExists(agentsDir)) {
      const files = await fs.readdir(agentsDir);
      for (const f of files) {
        if (hasSpecPrefix(f) && f.endsWith(".toml")) {
          existing.push(path.join(".codex", "agents", f));
        }
      }
    }

    // Native skill directories in .agents/skills/
    const skillsDir = path.join(workspaceRoot, ".agents", "skills");
    if (await fs.pathExists(skillsDir)) {
      const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith("spec-")) {
          const skillMd = path.join(skillsDir, d.name, "SKILL.md");
          if (await fs.pathExists(skillMd)) {
            existing.push(path.join(".agents", "skills", d.name, "SKILL.md"));
          }
        }
      }
    }

    // Root AGENTS.md
    const rootFile = path.join(workspaceRoot, "AGENTS.md");
    if (await fs.pathExists(rootFile)) {
      existing.push("AGENTS.md");
    }

    return existing;
  }

  async detectHarnessUsage(workspaceRoot: string) {
    return detectHarnessMarkers(workspaceRoot, {
      projectStrong: [".codex"],
      projectWeak: ["AGENTS.md"],
      userWeak: [".codex"],
      commands: ["codex"],
    });
  }

  async getMemorySeedSource(
    workspaceRoot: string
  ): Promise<{ path: string; label: string } | null> {
    const p = path.join(workspaceRoot, "AGENTS.md");
    if (await fs.pathExists(p)) {
      return {
        path: "AGENTS.md",
        label: "Codex root instructions (AGENTS.md)",
      };
    }
    return null;
  }

  getPostInitMessage(): string {
    return [
      "",
      "📋 OpenAI Codex setup complete!",
      "",
      "  Subagents : .codex/agents/spec-<name>.toml  (noun-form — e.g. spec-planner)",
      "  Skills    : .agents/skills/spec-<name>/SKILL.md (auto-discovered by Codex)",
      "  Root      : AGENTS.md (Codex reads it automatically as project context)",
      "",
      "  How to use:",
      "  1. Codex automatically loads AGENTS.md for project instructions",
      "  2. Invoke a subagent by name (e.g., 'use spec-planner to draft a plan')",
      "  3. Skills are auto-discovered — describe the task and Codex activates the right skill",
      "  4. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 OpenAI Codex global install complete!",
      "",
      `  Subagents : ~/.codex/agents/spec-<name>.toml`,
      `  Skills    : ~/.agents/skills/spec-<name>/SKILL.md`,
      `  Root      : ~/.codex/AGENTS.md (Codex reads it automatically as global context)`,
      "",
      "  These are available across all your workspaces in Codex.",
      "",
    ].join("\n");
  }
}

/** Pick verb-form for prompt-only items, noun-form otherwise. */
function subagentFileName(internalName: string): string {
  return isPromptOnly(internalName)
    ? getPromptOutputName(internalName)
    : getAgentOutputName(internalName);
}

// ---------------------------------------------------------------------------
// AGENTS.md generation (root project file)
// ---------------------------------------------------------------------------

const SPEC_LITE_MARKER_START = "<!-- spec-lite:start -->";
const SPEC_LITE_MARKER_END = "<!-- spec-lite:end -->";

interface CodexAgentsBlockOptions {
  scope?: "project" | "global";
}

/**
 * Build the spec-lite block injected into AGENTS.md.
 * Skill names are passed in as a Set so we can list skills under their native
 * location and subagents under the Codex agents directory.
 */
export function generateCodexAgentsBlock(
  installedPrompts: string[],
  nativeSkillNames: Set<string> = new Set(),
  options: CodexAgentsBlockOptions = {}
): string {
  const isGlobal = options.scope === "global";
  const subagentNames = installedPrompts.filter(
    (name) => !nativeSkillNames.has(name)
  );
  const skillNames = installedPrompts.filter((name) =>
    nativeSkillNames.has(name)
  );
  const subagentsDir = isGlobal ? "~/.codex/agents/" : ".codex/agents/";
  const skillsDir = isGlobal ? "~/.agents/skills/" : ".agents/skills/";

  const lines: string[] = [
    SPEC_LITE_MARKER_START,
    "## spec-lite Agents & Skills",
    "",
    "This project uses [spec-lite](https://github.com/abranjith/spec-lite) agent and skill prompts",
    "for structured software engineering workflows.",
    "",
    "Typical flow: brainstorm → plan → feature → implement → review → document. Memory supplies standing instructions across every role.",
    "",
  ];

  if (subagentNames.length > 0) {
    lines.push(
      `**Subagents** (\`${subagentsDir}\`) — invoke by name (e.g., \`use spec-planner\`):`,
      ""
    );
    for (const name of subagentNames) {
      const subagent = toSpecName(subagentFileName(name));
      const subagentPath = `${subagentsDir}${subagent}.toml`;
      lines.push(
        isGlobal
          ? `- \`${subagent}\` (${subagentPath})`
          : `- [${subagent}](${subagentPath})`
      );
    }
  }

  if (skillNames.length > 0) {
    lines.push(
      "",
      `**Skills** (\`${skillsDir}\`) — auto-discovered by Codex based on the task:`,
      ""
    );
    for (const name of skillNames) {
      const dirName = toSpecName(name);
      const skillPath = `${skillsDir}${dirName}/SKILL.md`;
      lines.push(
        isGlobal
          ? `- \`${dirName}\` (${skillPath})`
          : `- [${dirName}](${skillPath})`
      );
    }
  }

  if (hasPromptName(installedPrompts, "plan_critic")) {
    lines.push(
      "",
      "Suggested manual checkpoint after planning:",
      "",
      "- Use the `spec-plan-critic` skill against `.spec-lite/plan.md` to pressure-test feasibility before implementation."
    );
  }

  lines.push(
    "",
    "Planning outputs are written to `.spec-lite/`; documentation uses the directory configured in `.spec-lite.json`.",
    SPEC_LITE_MARKER_END
  );

  return lines.join("\n");
}

/**
 * Merge the spec-lite block into an existing AGENTS.md, or create fresh content.
 * If markers are present, the block between them is replaced. Otherwise it is appended.
 */
export function mergeCodexAgentsMd(
  existingContent: string | null,
  installedPrompts: string[],
  nativeSkillNames: Set<string> = new Set(),
  options: CodexAgentsBlockOptions = {}
): string {
  const block = generateCodexAgentsBlock(
    installedPrompts,
    nativeSkillNames,
    options
  );

  if (!existingContent) {
    const headerTitle =
      options.scope === "global"
        ? "# Codex Global Instructions"
        : "# Project Instructions";
    const headerDescription =
      options.scope === "global"
        ? "Codex reads this file automatically for user-level context."
        : "Codex reads this file automatically for project-level context.";
    const header = [headerTitle, "", headerDescription, ""].join("\n");
    return header + block + "\n";
  }

  const startIdx = existingContent.indexOf(SPEC_LITE_MARKER_START);
  const endIdx = existingContent.indexOf(SPEC_LITE_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      existingContent.slice(0, startIdx) +
      block +
      existingContent.slice(endIdx + SPEC_LITE_MARKER_END.length)
    );
  }

  const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
  return existingContent + separator + block + "\n";
}
