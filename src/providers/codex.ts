import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getAgentOutputName, getPromptOutputName, isPromptOnly } from "../utils/prompts.js";
import { getSkillDirName } from "./copilot.js";

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
 *  - Source agents → TOML subagents at `.codex/agents/spec.<agentName>.toml`
 *    (noun-form). The full markdown body is embedded in `developer_instructions`.
 *  - Source skills → `.agents/skills/spec-<name>/SKILL.md` (native Agent Skills).
 *  - Reference items (help, orchestrator) are skipped — Codex has no
 *    matching primitive for prompt-only docs.
 *  - A managed `AGENTS.md` is written at the project root and references the
 *    installed subagents and skills.
 */
export class CodexProvider implements Provider {
  name = "OpenAI Codex";
  alias = "codex";
  description = "OpenAI Codex (AGENTS.md + .codex/agents subagents + .agents/skills)";
  /**
   * Codex's "agents" are TOML files routed through the prompt path so we can
   * skip writing a separate markdown file. `supportsAgents = false` keeps the
   * shared init/install/update flow from emitting an agent file in addition.
   */
  supportsAgents = false;
  supportsNativeSkills = true;
  supportsGlobal = true;

  getOutputPaths(promptName: string): { prompt: string } {
    return {
      prompt: path.join(".codex", "agents", `spec.${this.subagentFileName(promptName)}.toml`),
    };
  }

  getGlobalOutputPaths(promptName: string): { prompt: string } {
    const homeDir = os.homedir();
    return {
      prompt: path.join(
        homeDir,
        ".codex",
        "agents",
        `spec.${this.subagentFileName(promptName)}.toml`
      ),
    };
  }

  getSkillOutputDir(skillName: string): string {
    return path.join(".agents", "skills", getSkillDirName(skillName));
  }

  getGlobalSkillOutputDir(skillName: string): string {
    const homeDir = os.homedir();
    return path.join(homeDir, ".agents", "skills", getSkillDirName(skillName));
  }

  /**
   * Render the source content as a Codex subagent TOML file.
   *
   * Codex requires `name`, `description`, and `developer_instructions`. The
   * full markdown body (including the `<!-- project-context -->` block) is
   * placed inside a multi-line `developer_instructions` string so that
   * `extractProjectContext` / `replaceProjectContext` keep working during
   * `spec-lite update`.
   */
  transformPrompt(content: string, meta: PromptMeta): string {
    const subagentName = `spec.${this.subagentFileName(meta.name)}`;
    const lines = [
      `# spec-lite | ${meta.name}`,
      `# DO NOT EDIT below the project-context block — managed by spec-lite`,
      `# To update: run "spec-lite update" — your Project Context edits will be preserved`,
      "",
      `name = ${tomlBasicString(subagentName)}`,
      `description = ${tomlBasicString(meta.description || meta.title)}`,
      "",
      `developer_instructions = ${tomlMultilineString(content)}`,
      "",
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
        if (f.startsWith("spec.") && f.endsWith(".toml")) {
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

  async getMemorySeedSource(
    workspaceRoot: string
  ): Promise<{ path: string; label: string } | null> {
    const p = path.join(workspaceRoot, "AGENTS.md");
    if (await fs.pathExists(p)) {
      return { path: "AGENTS.md", label: "Codex root instructions (AGENTS.md)" };
    }
    return null;
  }

  getPostInitMessage(): string {
    return [
      "",
      "📋 OpenAI Codex setup complete!",
      "",
      "  Subagents : .codex/agents/spec.<name>.toml  (noun-form — e.g. spec.planner)",
      "  Skills    : .agents/skills/spec-<name>/SKILL.md (auto-discovered by Codex)",
      "  Root      : AGENTS.md (Codex reads it automatically as project context)",
      "",
      "  How to use:",
      "  1. Codex automatically loads AGENTS.md for project instructions",
      "  2. Invoke a subagent by name (e.g., 'use spec.planner to draft a plan')",
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
      `  Subagents : ~/.codex/agents/spec.<name>.toml`,
      `  Skills    : ~/.agents/skills/spec-<name>/SKILL.md`,
      "",
      "  These are available across all your workspaces in Codex.",
      "",
    ].join("\n");
  }

  /** Pick verb-form for prompt-only items, noun-form otherwise. */
  private subagentFileName(internalName: string): string {
    return isPromptOnly(internalName)
      ? getPromptOutputName(internalName)
      : getAgentOutputName(internalName);
  }
}

// ---------------------------------------------------------------------------
// AGENTS.md generation (root project file)
// ---------------------------------------------------------------------------

const SPEC_LITE_MARKER_START = "<!-- spec-lite:start -->";
const SPEC_LITE_MARKER_END = "<!-- spec-lite:end -->";

/**
 * Build the spec-lite block injected into AGENTS.md.
 * Skill names are passed in as a Set so we can list skills under their native
 * `.agents/skills/` location and subagents under `.codex/agents/`.
 */
export function generateCodexAgentsBlock(
  installedPrompts: string[],
  nativeSkillNames: Set<string> = new Set()
): string {
  const subagentNames = installedPrompts.filter((name) => !nativeSkillNames.has(name));
  const skillNames = installedPrompts.filter((name) => nativeSkillNames.has(name));

  const lines: string[] = [
    SPEC_LITE_MARKER_START,
    "## spec-lite Agents & Skills",
    "",
    "This project uses [spec-lite](https://github.com/abranjith/spec-lite) agent and skill prompts",
    "for structured software engineering workflows.",
    "",
  ];

  if (subagentNames.length > 0) {
    lines.push(
      "**Subagents** (`.codex/agents/`) — invoke by name (e.g., `use spec.planner`):",
      ""
    );
    for (const name of subagentNames) {
      const subagent = isPromptOnly(name)
        ? getPromptOutputName(name)
        : getAgentOutputName(name);
      lines.push(`- [spec.${subagent}](.codex/agents/spec.${subagent}.toml)`);
    }
  }

  if (skillNames.length > 0) {
    lines.push(
      "",
      "**Skills** (`.agents/skills/`) — auto-discovered by Codex based on the task:",
      ""
    );
    for (const name of skillNames) {
      const dirName = getSkillDirName(name);
      lines.push(`- [${dirName}](.agents/skills/${dirName}/SKILL.md)`);
    }
  }

  if (installedPrompts.includes("plan_critic")) {
    lines.push(
      "",
      "Suggested manual checkpoint after planning:",
      "",
      "- Use `spec.plan_critic` against `.spec-lite/plan.md` to pressure-test feasibility before implementation.",
    );
  }

  lines.push(
    "",
    "Outputs are written to `.spec-lite/` (plans, features, reviews, memory).",
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
  nativeSkillNames: Set<string> = new Set()
): string {
  const block = generateCodexAgentsBlock(installedPrompts, nativeSkillNames);

  if (!existingContent) {
    const header = [
      "# Project Instructions",
      "",
      "Codex reads this file automatically for project-level context.",
      "",
    ].join("\n");
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

// ---------------------------------------------------------------------------
// TOML serialization helpers
// ---------------------------------------------------------------------------

/** Render a single-line TOML basic string. Escapes `\`, `"`, and control chars. */
function tomlBasicString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * Render a multi-line TOML string for `developer_instructions`. Prefers literal
 * (`'''`) syntax — no escapes, content survives verbatim — and falls back to
 * basic (`"""`) with backslash escaping if the content contains a `'''` run.
 */
function tomlMultilineString(value: string): string {
  if (!value.includes("'''")) {
    // Literal multi-line: leading newline after opener is stripped by TOML, so add one.
    return `'''\n${value}\n'''`;
  }

  // Fallback: basic multi-line. Escape `\` and break up any `"""` runs by
  // backslash-escaping the third quote of each run.
  let escaped = value.replace(/\\/g, "\\\\");
  while (escaped.includes('"""')) {
    escaped = escaped.replace(/"""/g, '""\\"');
  }
  return `"""\n${escaped}\n"""`;
}
