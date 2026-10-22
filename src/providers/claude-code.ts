import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta, OutputScope } from "./base.js";
import {
  getAgentOutputName,
  getPromptOutputName,
  hasPromptName,
  isPromptOnly,
} from "../utils/prompts.js";
import {
  hasSpecPrefix,
  legacySpecName,
  toSpecName,
  yamlFrontmatter,
} from "../utils/naming.js";
import { detectHarnessMarkers } from "../utils/harness-detection.js";

/**
 * Claude Code (Anthropic) provider.
 *
 * Claude Code supports:
 * - `CLAUDE.md` at the project root — loaded automatically as project instructions
 * - `.claude/` directory for additional configuration
 *
 * - `.claude/skills/` for native Agent Skills (SKILL.md directories)
 *
 * Strategy:
 * - Agent files  → `.claude/agents/spec-<agentName>.md`   (noun-form, with name/description frontmatter)
 * - Skills       → `.claude/skills/spec-<name>/SKILL.md`  (native Agent Skills)
 * - Prompt/Command files → `.claude/commands/spec-<promptName>.md`  (verb-form, agents + references)
 * - For prompt-only items, only the commands directory is used (verb-form)
 * - Create/update a root `CLAUDE.md` that references the spec-lite agent collection
 */
export class ClaudeCodeProvider implements Provider {
  name = "Claude Code";
  alias = "claude-code";
  description = "Claude Code (Anthropic's coding agent)";
  supportsAgents = true;
  supportsNativeSkills = true;
  supportsGlobal = true;

  getOutputPaths(promptName: string): { agent?: string; prompt: string } {
    return projectPaths(promptName, toSpecName);
  }

  getGlobalOutputPaths(promptName: string): {
    agent?: string;
    prompt?: string;
  } {
    return globalPaths(promptName, toSpecName);
  }

  getLegacyOutputPaths(
    promptName: string,
    scope: OutputScope
  ): { agent?: string; prompt?: string } {
    return scope === "global"
      ? globalPaths(promptName, legacySpecName)
      : projectPaths(promptName, legacySpecName);
  }

  getSkillOutputDir(skillName: string): string {
    return path.join(".claude", "skills", toSpecName(skillName));
  }

  getGlobalSkillOutputDir(skillName: string): string {
    return path.join(os.homedir(), ".claude", "skills", toSpecName(skillName));
  }

  /** Transform content into a subagent file (noun-form) with the frontmatter Claude Code requires. */
  transformAgent(content: string, meta: PromptMeta): string {
    const frontmatter = yamlFrontmatter({
      name: toSpecName(getAgentOutputName(meta.name)),
      description: meta.description || meta.title,
    });
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");
    return frontmatter + header + content;
  }

  /** Transform content into a command file (verb-form); the file name is the command name. */
  transformPrompt(content: string, meta: PromptMeta): string {
    const frontmatter = yamlFrontmatter({
      description: meta.description || meta.title,
    });
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");
    return frontmatter + header + content;
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];

    // Check for agent files in .claude/agents/
    const agentsDir = path.join(workspaceRoot, ".claude", "agents");
    if (await fs.pathExists(agentsDir)) {
      const files = await fs.readdir(agentsDir);
      for (const f of files) {
        if (hasSpecPrefix(f) && f.endsWith(".md")) {
          existing.push(path.join(".claude", "agents", f));
        }
      }
    }

    // Check for command files in .claude/commands/
    const claudeCommandsDir = path.join(workspaceRoot, ".claude", "commands");
    if (await fs.pathExists(claudeCommandsDir)) {
      const files = await fs.readdir(claudeCommandsDir);
      for (const f of files) {
        if (hasSpecPrefix(f) && f.endsWith(".md")) {
          existing.push(path.join(".claude", "commands", f));
        }
      }
    }

    // Check for native skill directories in .claude/skills/
    const skillsDir = path.join(workspaceRoot, ".claude", "skills");
    if (await fs.pathExists(skillsDir)) {
      const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith("spec-")) {
          const skillMd = path.join(skillsDir, d.name, "SKILL.md");
          if (await fs.pathExists(skillMd)) {
            existing.push(path.join(".claude", "skills", d.name, "SKILL.md"));
          }
        }
      }
    }

    // Check for root CLAUDE.md
    const rootFile = path.join(workspaceRoot, "CLAUDE.md");
    if (await fs.pathExists(rootFile)) {
      existing.push("CLAUDE.md");
    }

    return existing;
  }

  async detectHarnessUsage(workspaceRoot: string) {
    return detectHarnessMarkers(workspaceRoot, {
      projectStrong: [".claude", "CLAUDE.md"],
      userWeak: [".claude"],
      commands: ["claude"],
    });
  }

  async getMemorySeedSource(
    workspaceRoot: string
  ): Promise<{ path: string; label: string } | null> {
    const p = path.join(workspaceRoot, "CLAUDE.md");
    if (await fs.pathExists(p)) {
      return {
        path: "CLAUDE.md",
        label: "Claude root instructions (CLAUDE.md)",
      };
    }
    return null;
  }

  getPostInitMessage(): string {
    return [
      "",
      "📋 Claude Code setup complete!",
      "",
      "  Agent files  : .claude/agents/spec-<name>.md  (noun-form — e.g. spec-planner)",
      "  Skill dirs   : .claude/skills/spec-<name>/SKILL.md  (auto-discovered — e.g. /spec-implement)",
      "  Command files: .claude/commands/spec-<name>.md  (verb-form — e.g. /spec-plan)",
      "",
      "  How to use:",
      "  1. Claude Code automatically reads CLAUDE.md for project context",
      '  2. Delegate to an agent: "Use the spec-planner agent to create a plan"',
      "  3. Run a skill or command with /spec-<name>, or describe the task and Claude picks the skill",
      "  4. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 Claude Code global install complete!",
      "",
      `  Agent files  : ~/.claude/agents/spec-<name>.md`,
      `  Skill dirs   : ~/.claude/skills/spec-<name>/SKILL.md`,
      "",
      "  These are available across all your workspaces in Claude Code.",
      "",
    ].join("\n");
  }
}

/**
 * Generate the root CLAUDE.md content that references spec-lite agents and skills.
 */
export function generateClaudeRootMd(
  installedPrompts: string[],
  nativeSkillNames: Set<string> = new Set()
): string {
  const skillNames = installedPrompts.filter((name) =>
    nativeSkillNames.has(name)
  );
  const commandNames = installedPrompts.filter(
    (name) => !nativeSkillNames.has(name)
  );

  const lines = [
    "<!-- spec-lite managed — regenerated on spec-lite init/update -->",
    "",
    "# Project Instructions",
    "",
    "This project uses [spec-lite](https://github.com/abranjith/spec-lite) agent and skill prompts",
    "for structured software engineering workflows.",
    "",
    "## Available Agents & Skills",
    "",
    "The following specialist agents and skills are available:",
    "",
    "Typical flow: brainstorm → plan → feature → implement → review → document. Memory supplies standing instructions across every role.",
    "",
    "**Agent files** (`.claude/agents/`):",
    "",
  ];

  for (const name of installedPrompts) {
    if (!isPromptOnly(name)) {
      const agentName = toSpecName(getAgentOutputName(name));
      lines.push(`- [${agentName}](.claude/agents/${agentName}.md)`);
    }
  }

  if (skillNames.length > 0) {
    lines.push(
      "",
      "**Skill directories** (`.claude/skills/`) — auto-discovered, or run with `/<name>`:",
      ""
    );
    for (const name of skillNames) {
      const dirName = toSpecName(name);
      lines.push(`- [${dirName}](.claude/skills/${dirName}/SKILL.md)`);
    }
  }

  if (commandNames.length > 0) {
    lines.push("", "**Command files** (`.claude/commands/`):", "");
    for (const name of commandNames) {
      const promptName = toSpecName(getPromptOutputName(name));
      lines.push(`- [${promptName}](.claude/commands/${promptName}.md)`);
    }
  }

  lines.push(
    "",
    "## Usage",
    "",
    "To use an agent, ask Claude to delegate to it by name:",
    "",
    "```text",
    "Use the spec-planner agent to create a technical plan for this project.",
    "```"
  );

  if (hasPromptName(installedPrompts, "plan_critic")) {
    lines.push(
      "",
      "Suggested manual checkpoint after planning:",
      "",
      "```text",
      "/spec-plan-critic .spec-lite/plan.md",
      "```"
    );
  }

  lines.push(
    "",
    "## Output Directory",
    "",
    "Planning, feature, review, and memory outputs are written to `.spec-lite/`; project documentation uses the directory configured in `.spec-lite.json`:",
    "",
    "```text",
    ".spec-lite/",
    "├── brainstorm.md",
    "├── plan.md                    # Default plan (simple projects)",
    "├── plan_<name>.md              # Named plans (complex projects)",
    "├── TODO.md",
    "├── memory.md",
    "├── features/",
    "└── reviews/",
    "```",
    ""
  );

  return lines.join("\n");
}

type NameFormatter = (name: string) => string;

/** Project output paths; `format` picks the current or legacy naming. */
function projectPaths(
  promptName: string,
  format: NameFormatter
): { agent?: string; prompt: string } {
  const prompt = path.join(
    ".claude",
    "commands",
    `${format(getPromptOutputName(promptName))}.md`
  );
  if (isPromptOnly(promptName)) return { prompt };
  return {
    agent: path.join(
      ".claude",
      "agents",
      `${format(getAgentOutputName(promptName))}.md`
    ),
    prompt,
  };
}

/** Global output paths: agent files only, except prompt-only items which become commands. */
function globalPaths(
  promptName: string,
  format: NameFormatter
): { agent?: string; prompt?: string } {
  const homeDir = os.homedir();
  if (isPromptOnly(promptName)) {
    return {
      prompt: path.join(
        homeDir,
        ".claude",
        "commands",
        `${format(getPromptOutputName(promptName))}.md`
      ),
    };
  }
  return {
    agent: path.join(
      homeDir,
      ".claude",
      "agents",
      `${format(getAgentOutputName(promptName))}.md`
    ),
  };
}
