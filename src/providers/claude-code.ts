import path from "path";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";

/**
 * Claude Code (Anthropic) provider.
 *
 * Claude Code supports:
 * - `CLAUDE.md` at the project root — loaded automatically as project instructions
 * - `.claude/` directory for additional configuration
 * - Nested `CLAUDE.md` files in subdirectories for scoped instructions
 *
 * Strategy:
 * - Write individual agent files to `.claude/prompts/<name>.md`
 * - Create/update a root `CLAUDE.md` that references the spec-lite agent collection
 *   and provides a high-level overview
 */
export class ClaudeCodeProvider implements Provider {
  name = "Claude Code";
  alias = "claude-code";
  description = "Claude Code (Anthropic's coding agent)";

  getTargetPath(promptName: string): string {
    return path.join(".claude", "prompts", `${promptName}.md`);
  }

  transformPrompt(content: string, meta: PromptMeta): string {
    // Claude Code reads markdown natively. We add a header comment.
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");

    return header + content;
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];

    // Check for claude prompts directory
    const claudePromptsDir = path.join(
      workspaceRoot,
      ".claude",
      "prompts"
    );
    if (await fs.pathExists(claudePromptsDir)) {
      const files = await fs.readdir(claudePromptsDir);
      for (const f of files) {
        if (f.endsWith(".md")) {
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

  getPostInitMessage(): string {
    return [
      "",
      "📋 Claude Code setup complete!",
      "",
      "  Your sub-agent prompts are in .claude/prompts/",
      "  A root CLAUDE.md has been created with references to the sub-agents.",
      "",
      "  How to use:",
      "  1. Claude Code automatically reads CLAUDE.md for project context",
      '  2. Reference specific sub-agents: "Use the planner from .claude/prompts/planner.md"',
      "  3. Customize the Project Context block in each file for your project",
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
    "This project uses [spec-lite](https://github.com/ranjithab/spec-lite) sub-agent prompts",
    "for structured software engineering workflows.",
    "",
    "## Available Sub-Agents",
    "",
    "The following specialist sub-agents are available in `.claude/prompts/`:",
    "",
  ];

  for (const name of installedPrompts) {
    lines.push(`- [${name}](.claude/prompts/${name}.md)`);
  }

  lines.push(
    "",
    "## Usage",
    "",
    "To use a sub-agent, reference its prompt file in your conversation:",
    "",
    '```text',
    "Use the planner from .claude/prompts/planner.md to create a technical plan for this project.",
    '```',
    "",
    "## Output Directory",
    "",
    "Sub-agent outputs are written to the `.spec/` directory:",
    "",
    "```text",
    ".spec/",
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
