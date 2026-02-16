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
    return path.join(".github", "copilot", `${promptName}.md`);
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
        if (f.endsWith(".md")) {
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

  getPostInitMessage(): string {
    return [
      "",
      "📋 GitHub Copilot setup complete!",
      "",
      "  Your agent prompts are in .github/copilot/",
      "",
      "  How to use:",
      "  1. Open GitHub Copilot Chat in VS Code",
      "  2. The prompts are automatically available as custom instructions",
      "  3. Reference them with #<filename> in Copilot Chat",
      "  4. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }
}
