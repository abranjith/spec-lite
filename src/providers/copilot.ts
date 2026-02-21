import path from "path";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";

/**
 * GitHub Copilot provider.
 *
 * Writes individual agent files to `.github/copilot-instructions/` as markdown,
 * plus a main `.github/copilot-instructions.md` that references the spec-lite agents.
 *
 * GitHub Copilot supports:
 * - `.github/copilot-instructions.md` — global instructions loaded into every Copilot Chat session
 * - Individual prompt files that can be referenced via @workspace or loaded as custom instructions
 */
export class CopilotProvider implements Provider {
  name = "GitHub Copilot";
  alias = "copilot";
  description = "GitHub Copilot (VS Code, JetBrains, Neovim)";

  getTargetPath(promptName: string): string {
    return path.join(".github", "copilot", `${promptName}.prompt.md`);
  }

  transformPrompt(content: string, meta: PromptMeta): string {
    // Copilot expects standard markdown. We add a brief header comment
    // identifying this as a spec-lite managed file.
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");

    return header + content;
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];

    // Check for copilot instructions directory
    const copilotDir = path.join(workspaceRoot, ".github", "copilot");
    if (await fs.pathExists(copilotDir)) {
      const files = await fs.readdir(copilotDir);
      for (const f of files) {
        if (f.endsWith(".prompt.md") || f.endsWith(".md")) {
          existing.push(path.join(".github", "copilot", f));
        }
      }
    }

    // Check for main instructions file
    const mainFile = path.join(
      workspaceRoot,
      ".github",
      "copilot-instructions.md"
    );
    if (await fs.pathExists(mainFile)) {
      existing.push(".github/copilot-instructions.md");
    }

    return existing;
  }

  async getMemorySeedSource(
    workspaceRoot: string
  ): Promise<{ path: string; label: string } | null> {
    const p = path.join(workspaceRoot, ".github", "copilot-instructions.md");
    if (await fs.pathExists(p)) {
      return { path: ".github/copilot-instructions.md", label: "GitHub Copilot global instructions" };
    }
    return null;
  }

  getPostInitMessage(): string {
    return [
      "",
      "📋 GitHub Copilot setup complete!",
      "",
      "  Your sub-agent prompts are in .github/copilot/",
      "",
      "  How to use:",
      "  1. Open GitHub Copilot Chat in VS Code",
      "  2. Sub-agents are available as slash commands — type /prompt_name",
      "     (e.g., /brainstorm, /planner, /feature)",
      "  3. Files ending in .prompt.md are natively recognized by Copilot",
      "  4. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }
}

const SPEC_LITE_MARKER_START = "<!-- spec-lite:start -->";
const SPEC_LITE_MARKER_END = "<!-- spec-lite:end -->";

/**
 * Generate the spec-lite block to inject into (or create as) copilot-instructions.md.
 */
export function generateSpecLiteBlock(installedPrompts: string[]): string {
  const lines = [
    SPEC_LITE_MARKER_START,
    "## spec-lite Sub-Agents",
    "",
    "This project uses [spec-lite](https://github.com/ranjithab/spec-lite) sub-agent prompts",
    "for structured software engineering workflows.",
    "",
    "The following specialist sub-agents are available in `.github/copilot/`:",
    "",
  ];

  for (const name of installedPrompts) {
    lines.push(`- [${name}](.github/copilot/${name}.prompt.md)`);
  }

  lines.push(
    "",
    "To invoke a sub-agent in Copilot Chat, use the `#` file reference or type `/` to browse prompt files.",
    SPEC_LITE_MARKER_END
  );

  return lines.join("\n");
}

/**
 * Merge the spec-lite block into an existing copilot-instructions.md, or create fresh content.
 * If the file already has spec-lite markers, the block between them is replaced.
 * Otherwise the block is appended.
 */
export function mergeCopilotInstructions(
  existingContent: string | null,
  installedPrompts: string[]
): string {
  const block = generateSpecLiteBlock(installedPrompts);

  if (!existingContent) {
    return block + "\n";
  }

  // Replace existing spec-lite block if markers are present
  const startIdx = existingContent.indexOf(SPEC_LITE_MARKER_START);
  const endIdx = existingContent.indexOf(SPEC_LITE_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      existingContent.slice(0, startIdx) +
      block +
      existingContent.slice(endIdx + SPEC_LITE_MARKER_END.length)
    );
  }

  // Append the block to existing content (preserving user content)
  const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
  return existingContent + separator + block + "\n";
}
