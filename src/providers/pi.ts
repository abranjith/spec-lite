import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getPromptOutputName } from "../utils/prompts.js";

/**
 * Pi provider — prompts only (no agent files).
 *
 * Pi reads YAML frontmatter with a `description` field.
 * The filename becomes the `/command` name in Chat.
 *
 * Paths:
 *  - Project:  `.pi/prompts/spec.<verb>.md`
 *  - Global:   `~/.pi/agent/prompts/spec.<verb>.md`
 */
export class PiProvider implements Provider {
  name = "Pi";
  alias = "pi";
  description = "Pi coding agent (prompts only)";
  supportsAgents = false;
  supportsGlobal = true;

  getOutputPaths(promptName: string): { prompt: string } {
    const outName = getPromptOutputName(promptName);
    return {
      prompt: path.join(".pi", "prompts", `spec.${outName}.md`),
    };
  }

  getGlobalOutputPaths(promptName: string): { prompt: string } {
    const homeDir = os.homedir();
    const outName = getPromptOutputName(promptName);
    return {
      prompt: path.join(homeDir, ".pi", "agent", "prompts", `spec.${outName}.md`),
    };
  }

  transformPrompt(content: string, meta: PromptMeta): string {
    // Pi uses YAML frontmatter with a description field
    const frontmatter = [
      "---",
      `description: ${meta.description}`,
      "---",
      "",
    ].join("\n");
    return frontmatter + content;
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];
    const dir = path.join(workspaceRoot, ".pi", "prompts");

    if (await fs.pathExists(dir)) {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".md")) {
          existing.push(path.join(".pi", "prompts", f));
        }
      }
    }

    return existing;
  }

  async getMemorySeedSource(
    _workspaceRoot: string
  ): Promise<{ path: string; label: string } | null> {
    return null;
  }

  getPostInitMessage(): string {
    return [
      "",
      "📋 Pi setup complete!",
      "",
      "  Your sub-agent prompts are in .pi/prompts/",
      "",
      "  How to use:",
      "  1. Open Pi Chat",
      "  2. Type / to browse available spec-lite commands",
      "  3. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 Pi global install complete!",
      "",
      `  Prompt files : ~/.pi/agent/prompts/spec.<name>.md`,
      "",
      "  These are available across all your workspaces in Pi Chat.",
      "",
    ].join("\n");
  }
}
