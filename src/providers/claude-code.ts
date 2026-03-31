import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getAgentOutputName, getPromptOutputName, isPromptOnly } from "../utils/prompts.js";

/**
 * Claude Code (Anthropic) provider.
 *
 * Claude Code supports:
 * - `CLAUDE.md` at the project root — loaded automatically as project instructions
 * - `.claude/` directory for additional configuration
 *
 * Strategy:
 * - Agent files  → `.claude/agents/spec.<agentName>.md`   (noun-form)
 * - Prompt files → `.claude/prompts/spec.<promptName>.md`  (verb-form)
 * - For prompt-only items, only the prompts directory is used (verb-form)
 * - Create/update a root `CLAUDE.md` that references the spec-lite agent collection
 */
export class ClaudeCodeProvider implements Provider {
  name = "Claude Code";
  alias = "claude-code";
  description = "Claude Code (Anthropic's coding agent)";
  supportsAgents = true;
  supportsGlobal = true;

  getOutputPaths(promptName: string): { agent?: string; prompt: string } {
    const promptOutName = getPromptOutputName(promptName);
    const promptPath = path.join(".claude", "prompts", `spec.${promptOutName}.md`);

    if (isPromptOnly(promptName)) {
      return { prompt: promptPath };
    }

    const agentName = getAgentOutputName(promptName);
    return {
      agent: path.join(".claude", "agents", `spec.${agentName}.md`),
      prompt: promptPath,
    };
  }

  getGlobalOutputPaths(promptName: string): { agent?: string; prompt?: string } {
    const homeDir = os.homedir();

    // Global install for Claude only writes agent files
    if (isPromptOnly(promptName)) {
      const promptOutName = getPromptOutputName(promptName);
      return {
        prompt: path.join(homeDir, ".claude", "prompts", `spec.${promptOutName}.md`),
      };
    }

    const agentName = getAgentOutputName(promptName);
    return {
      agent: path.join(homeDir, ".claude", "agents", `spec.${agentName}.md`),
    };
  }

  /** Transform content into an agent file (noun-form). */
  transformAgent(content: string, meta: PromptMeta): string {
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");
    return header + content;
  }

  /** Transform content into a prompt file (verb-form). */
  transformPrompt(content: string, meta: PromptMeta): string {
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");
    return header + content;
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];

    // Check for agent files in .claude/agents/
    const agentsDir = path.join(workspaceRoot, ".claude", "agents");
    if (await fs.pathExists(agentsDir)) {
      const files = await fs.readdir(agentsDir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".md")) {
          existing.push(path.join(".claude", "agents", f));
        }
      }
    }

    // Check for prompt files in .claude/prompts/
    const claudePromptsDir = path.join(workspaceRoot, ".claude", "prompts");
    if (await fs.pathExists(claudePromptsDir)) {
      const files = await fs.readdir(claudePromptsDir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".md")) {
          existing.push(path.join(".claude", "prompts", f));
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

  async getMemorySeedSource(
    workspaceRoot: string
  ): Promise<{ path: string; label: string } | null> {
    const p = path.join(workspaceRoot, "CLAUDE.md");
    if (await fs.pathExists(p)) {
      return { path: "CLAUDE.md", label: "Claude root instructions (CLAUDE.md)" };
    }
    return null;
  }

  getPostInitMessage(): string {
    return [
      "",
      "📋 Claude Code setup complete!",
      "",
      "  Agent files  : .claude/agents/spec.<name>.md  (noun-form — e.g. spec.planner)",
      "  Prompt files : .claude/prompts/spec.<name>.md  (verb-form — e.g. spec.plan)",
      "",
      "  How to use:",
      "  1. Claude Code automatically reads CLAUDE.md for project context",
      '  2. Reference specific sub-agents: "Use the planner from .claude/agents/spec.planner.md"',
      "  3. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 Claude Code global install complete!",
      "",
      `  Agent files  : ~/.claude/agents/spec.<name>.md`,
      "",
      "  These are available across all your workspaces in Claude Code.",
      "",
    ].join("\n");
  }
}

/**
 * Generate the root CLAUDE.md content that references spec-lite sub-agents.
 */
export function generateClaudeRootMd(
  installedPrompts: string[]
): string {
  const lines = [
    "<!-- spec-lite managed — regenerated on spec-lite init/update -->",
    "",
    "# Project Instructions",
    "",
    "This project uses [spec-lite](https://github.com/abranjith/spec-lite) sub-agent prompts",
    "for structured software engineering workflows.",
    "",
    "## Available Sub-Agents",
    "",
    "The following specialist sub-agents are available:",
    "",
    "**Agent files** (`.claude/agents/`):",
    "",
  ];

  for (const name of installedPrompts) {
    if (!isPromptOnly(name)) {
      const agentName = getAgentOutputName(name);
      lines.push(`- [spec.${agentName}](.claude/agents/spec.${agentName}.md)`);
    }
  }

  lines.push("", "**Prompt files** (`.claude/prompts/`):", "");

  for (const name of installedPrompts) {
    const promptName = getPromptOutputName(name);
    lines.push(`- [spec.${promptName}](.claude/prompts/spec.${promptName}.md)`);
  }

  lines.push(
    "",
    "## Usage",
    "",
    "To use a sub-agent, reference its prompt file in your conversation:",
    "",
    '```text',
    "Use the planner from .claude/agents/spec.planner.md to create a technical plan for this project.",
    '```',
    "",
    "## Output Directory",
    "",
    "Sub-agent outputs are written to the `.spec-lite/` directory:",
    "",
    "```text",
    ".spec-lite/",
    "├── brainstorm.md",
    "├── plan.md                    # Default plan (simple projects)",
    "├── plan_<name>.md              # Named plans (complex projects)",
    "├── TODO.md",
    "├── features/",
    "└── reviews/",
    "```",
    ""
  );

  return lines.join("\n");
}
