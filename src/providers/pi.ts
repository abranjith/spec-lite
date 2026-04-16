import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getPromptOutputName } from "../utils/prompts.js";
import { getSkillDirName } from "./copilot.js";

/**
 * Pi provider — prompts + native skills.
 *
 * Pi reads YAML frontmatter with a `description` field for prompts.
 * Pi natively supports Agent Skills (SKILL.md directories) with auto-discovery
 * and `/skill:<name>` commands.
 *
 * Paths:
 *  - Project prompts:  `.pi/prompts/spec.<verb>.md`
 *  - Project skills:   `.pi/skills/spec-<name>/SKILL.md`
 *  - Global prompts:   `~/.pi/agent/prompts/spec.<verb>.md`
 *  - Global skills:    `~/.pi/agent/skills/spec-<name>/SKILL.md`
 */
export class PiProvider implements Provider {
  name = "Pi";
  alias = "pi";
  description = "Pi coding agent (prompts + native skills)";
  supportsAgents = false;
  supportsNativeSkills = true;
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

  getSkillOutputDir(skillName: string): string {
    return path.join(".pi", "skills", getSkillDirName(skillName));
  }

  getGlobalSkillOutputDir(skillName: string): string {
    const homeDir = os.homedir();
    return path.join(homeDir, ".pi", "agent", "skills", getSkillDirName(skillName));
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

    // Check for prompt files in .pi/prompts/
    const dir = path.join(workspaceRoot, ".pi", "prompts");
    if (await fs.pathExists(dir)) {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".md")) {
          existing.push(path.join(".pi", "prompts", f));
        }
      }
    }

    // Check for native skill directories in .pi/skills/
    const skillsDir = path.join(workspaceRoot, ".pi", "skills");
    if (await fs.pathExists(skillsDir)) {
      const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith("spec-")) {
          const skillMd = path.join(skillsDir, d.name, "SKILL.md");
          if (await fs.pathExists(skillMd)) {
            existing.push(path.join(".pi", "skills", d.name, "SKILL.md"));
          }
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
      "  Prompt files : .pi/prompts/spec.<name>.md    (for agents & references)",
      "  Skill dirs   : .pi/skills/spec-<name>/SKILL.md  (auto-discovered by Pi)",
      "",
      "  How to use:",
      "  1. Open Pi Chat",
      "  2. Type / to browse available spec-lite commands",
      "  3. Skills are auto-discovered — use /skill:spec-<name> or let Pi activate them",
      "  4. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 Pi global install complete!",
      "",
      `  Prompt files : ~/.pi/agent/prompts/spec.<name>.md`,
      `  Skill dirs   : ~/.pi/agent/skills/spec-<name>/SKILL.md`,
      "",
      "  These are available across all your workspaces in Pi Chat.",
      "",
    ].join("\n");
  }
}
