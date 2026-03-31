import path from "path";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getPromptOutputName } from "../utils/prompts.js";

/**
 * Generic provider — for manual usage or unsupported AI tools.
 *
 * Writes prompts to `.spec-lite/prompts/` as raw markdown using verb-form names.
 * Users can copy-paste these into any LLM chat.
 */
export class GenericProvider implements Provider {
  name = "Generic";
  alias = "generic";
  description = "Raw prompts in .spec-lite/prompts/ (copy-paste into any LLM)";
  supportsAgents = false;
  supportsGlobal = false;

  getOutputPaths(promptName: string): { prompt: string } {
    const outName = getPromptOutputName(promptName);
    return {
      prompt: path.join(".spec-lite", "prompts", `spec.${outName}.md`),
    };
  }

  transformPrompt(content: string, meta: PromptMeta): string {
    const header = [
      `<!-- spec-lite | ${meta.name} | managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" -->`,
      "",
    ].join("\n");
    return header + content;
  }

  async detectExisting(workspaceRoot: string): Promise<string[]> {
    const existing: string[] = [];
    const dir = path.join(workspaceRoot, ".spec-lite", "prompts");

    if (await fs.pathExists(dir)) {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".md")) {
          existing.push(path.join(".spec-lite", "prompts", f));
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
      "📋 Generic setup complete!",
      "",
      "  Your sub-agent prompts are in .spec-lite/prompts/",
      "",
      "  How to use:",
      "  1. Open any prompt file and copy its content",
      "  2. Paste into your LLM of choice (ChatGPT, Claude, Gemini, etc.)",
      "  3. Fill in the Project Context section for your project",
      "  4. Start the conversation with your requirements",
      "",
    ].join("\n");
  }
}
