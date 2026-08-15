import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getAgentOutputName, getPromptOutputName, hasPromptName, isPromptOnly } from "../utils/prompts.js";
import { detectHarnessMarkers } from "../utils/harness-detection.js";

/**
 * Convert an internal skill name to its native Agent Skills output directory name.
 * Replaces underscores with hyphens and adds `spec-` prefix.
 * e.g., "implement" → "spec-implement", "document_feature" → "spec-document-feature"
 */
export function getSkillDirName(name: string): string {
  return `spec-${name.replace(/_/g, "-")}`;
}

// ---------------------------------------------------------------------------
// Handoffs map — derived from the orchestrator pipeline.
// Each key is an *internal* prompt name and the value is an ordered list of
// suggested next-step handoffs.  The `agent` field uses the "spec.<agentName>"
// convention (noun-form, matching the .agent.md file).
// ---------------------------------------------------------------------------

export interface Handoff {
  label: string;
  agent: string;
  prompt: string;
}

export const AGENT_HANDOFFS: Record<string, Handoff[]> = {
  help: [],
  orchestrator: [],
  brainstorm: [
    { label: "Create Plan", agent: "spec.planner", prompt: "Create a technical plan from this brainstorm." },
    { label: "Capture Conventions", agent: "spec.memorize", prompt: "Capture durable project conventions discovered during brainstorming." },
  ],
  plan: [
    { label: "Critique Plan", agent: "spec.plan_critic", prompt: "Critique this plan before implementation." },
    { label: "Break Down Features", agent: "spec.feature", prompt: "Create feature specifications for this plan." },
    { label: "Design Architecture", agent: "spec.architect", prompt: "Design the infrastructure architecture for this plan." },
    { label: "Design Data Model", agent: "spec.data_model_builder", prompt: "Design the relational data model for this plan." },
  ],
  plan_critic: [
    { label: "Revise Plan", agent: "spec.planner", prompt: "Revise the plan using this critique." },
    { label: "Break Down Features", agent: "spec.feature", prompt: "Create feature specifications after applying the critique." },
  ],
  architect: [
    { label: "Design Data Model", agent: "spec.data_model_builder", prompt: "Design the data model for this architecture." },
    { label: "Set Up Infrastructure", agent: "spec.devops", prompt: "Implement the infrastructure design." },
  ],
  feature: [
    { label: "Implement Feature", agent: "spec.implementer", prompt: "Implement this feature specification." },
    { label: "Write Unit Tests", agent: "spec.unit_tester", prompt: "Design unit tests for this feature specification." },
  ],
  plan_feature: [
    { label: "Implement Feature", agent: "spec.implementer", prompt: "Implement this focused feature specification." },
  ],
  implement: [
    { label: "Review Implementation", agent: "spec.reviewer", prompt: "Review this implemented feature for correctness, security, and performance." },
    { label: "Write Integration Tests", agent: "spec.integration_tester", prompt: "Write integration tests for this implementation." },
    { label: "Update Documentation", agent: "spec.documenter", prompt: "Update documentation for the implemented feature." },
  ],
  write_unit_tests: [
    { label: "Review Implementation", agent: "spec.reviewer", prompt: "Review the implementation and tests." },
    { label: "Write Integration Tests", agent: "spec.integration_tester", prompt: "Add integration coverage at component boundaries." },
  ],
  review: [
    { label: "Fix Findings", agent: "spec.fixer", prompt: "Fix the actionable REV findings in this review." },
    { label: "Document Changes", agent: "spec.documenter", prompt: "Update documentation for the reviewed implementation." },
  ],
  write_integration_tests: [
    { label: "Review Covered Code", agent: "spec.reviewer", prompt: "Review the code covered by these integration tests." },
    { label: "Update Documentation", agent: "spec.documenter", prompt: "Update documentation with verified integration behavior." },
  ],
  fix: [
    { label: "Review Fix", agent: "spec.reviewer", prompt: "Review this fix for regressions, security, and performance." },
    { label: "Write Regression Tests", agent: "spec.unit_tester", prompt: "Add unit regression coverage for this fix." },
    { label: "Update Documentation", agent: "spec.documenter", prompt: "Update documentation affected by this fix." },
  ],
  memorize: [
    { label: "Create Plan", agent: "spec.planner", prompt: "Create a plan using the captured conventions." },
    { label: "Document Project", agent: "spec.documenter", prompt: "Document the project using the captured conventions." },
  ],
  document: [
    { label: "Document Design", agent: "spec.design_documenter", prompt: "Update the architecture documentation." },
    { label: "Document Usage", agent: "spec.usage_documenter", prompt: "Update verified quickstart and usage documentation." },
    { label: "Update README", agent: "spec.readme_writer", prompt: "Update the README and documentation index." },
  ],
  document_feature: [
    { label: "Update README", agent: "spec.readme_writer", prompt: "Refresh the README index for this feature documentation." },
  ],
  document_design: [
    { label: "Update README", agent: "spec.readme_writer", prompt: "Refresh the README architecture links." },
  ],
  document_usage: [
    { label: "Update README", agent: "spec.readme_writer", prompt: "Refresh the README quickstart and usage links." },
  ],
  document_readme: [
    { label: "Review Documentation", agent: "spec.reviewer", prompt: "Review the documented commands and examples against the implementation." },
  ],
  devops: [
    { label: "Review Infrastructure", agent: "spec.reviewer", prompt: "Review the infrastructure configuration for correctness, security, and performance." },
    { label: "Document Deployment", agent: "spec.documenter", prompt: "Update deployment and operations documentation." },
  ],
  build_data_model: [
    { label: "Break Down Features", agent: "spec.feature", prompt: "Create feature specs using this data model." },
    { label: "Implement Data Layer", agent: "spec.implementer", prompt: "Implement the data layer from this model." },
  ],
  yolo: [
    { label: "Resume YOLO", agent: "spec.yolo", prompt: "Resume the autonomous pipeline from its saved state." },
    { label: "Check Pipeline Status", agent: "spec.help", prompt: "Show the current pipeline and available roles." },
  ],
  tool_help: [
    { label: "Implement With Tool", agent: "spec.implementer", prompt: "Continue implementation using the project tool where relevant." },
  ],
  todo: [],
};

/**
 * Build the YAML frontmatter block for a .agent.md file.
 * Looks up handoffs by internal prompt name.
 */
function buildAgentFrontmatter(meta: PromptMeta): string {
  const handoffs = AGENT_HANDOFFS[meta.name] ?? [];
  const lines: string[] = ["---", `description: ${meta.description}`];

  if (handoffs.length > 0) {
    lines.push("handoffs:");
    for (const h of handoffs) {
      lines.push(`  - label: ${h.label}`);
      lines.push(`    agent: ${h.agent}`);
      lines.push(`    prompt: ${h.prompt}`);
    }
  }

  lines.push("---", "");
  return lines.join("\n");
}

/**
 * GitHub Copilot provider.
 *
 * Writes two sets of files per prompt:
 *  - `.github/agents/spec.<agentName>.agent.md`  — custom agent files (noun-form, with frontmatter + handoffs)
 *  - `.github/prompts/spec.<promptName>.prompt.md` — prompt files (verb-form, plain markdown, for slash-command use)
 *
 * For prompt-only items, both files use the verb-form name (to preserve handoff support).
 *
 * Plus a `.github/copilot-instructions.md` that references the files.
 */
export class CopilotProvider implements Provider {
  name = "GitHub Copilot";
  alias = "copilot";
  description = "GitHub Copilot (VS Code, JetBrains, Neovim)";
  supportsAgents = true;
  supportsNativeSkills = true;
  supportsGlobal = true;

  getOutputPaths(promptName: string): { agent: string; prompt: string } {
    const agentName = isPromptOnly(promptName)
      ? getPromptOutputName(promptName) // prompt-only: use verb name for agent file too
      : getAgentOutputName(promptName);  // agent+prompt: use noun name
    const promptOutName = getPromptOutputName(promptName);

    return {
      agent: path.join(".github", "agents", `spec.${agentName}.agent.md`),
      prompt: path.join(".github", "prompts", `spec.${promptOutName}.prompt.md`),
    };
  }

  getGlobalOutputPaths(promptName: string): { agent: string; prompt: string } {
    const homeDir = os.homedir();
    const agentName = isPromptOnly(promptName)
      ? getPromptOutputName(promptName)
      : getAgentOutputName(promptName);
    const promptOutName = getPromptOutputName(promptName);

    return {
      agent: path.join(homeDir, ".copilot", "agents", `spec.${agentName}.agent.md`),
      prompt: path.join(homeDir, ".copilot", "prompts", `spec.${promptOutName}.prompt.md`),
    };
  }

  getSkillOutputDir(skillName: string): string {
    return path.join(".github", "skills", getSkillDirName(skillName));
  }

  getGlobalSkillOutputDir(skillName: string): string {
    const homeDir = os.homedir();
    return path.join(homeDir, ".copilot", "skills", getSkillDirName(skillName));
  }

  /** Transform content into an agent file: YAML frontmatter + prompt body. */
  transformAgent(content: string, meta: PromptMeta): string {
    return buildAgentFrontmatter(meta) + content;
  }

  /** Transform content into a prompt file (no frontmatter — just a managed-file header). */
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

    // Check for agent files in .github/agents/
    const agentsDir = path.join(workspaceRoot, ".github", "agents");
    if (await fs.pathExists(agentsDir)) {
      const files = await fs.readdir(agentsDir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".agent.md")) {
          existing.push(path.join(".github", "agents", f));
        }
      }
    }

    // Check for prompt files in .github/prompts/
    const promptsDir = path.join(workspaceRoot, ".github", "prompts");
    if (await fs.pathExists(promptsDir)) {
      const files = await fs.readdir(promptsDir);
      for (const f of files) {
        if (f.startsWith("spec.") && f.endsWith(".prompt.md")) {
          existing.push(path.join(".github", "prompts", f));
        }
      }
    }

    // Check for main instructions file
    const mainFile = path.join(workspaceRoot, ".github", "copilot-instructions.md");
    if (await fs.pathExists(mainFile)) {
      existing.push(".github/copilot-instructions.md");
    }

    // Check for native skill directories in .github/skills/
    const skillsDir = path.join(workspaceRoot, ".github", "skills");
    if (await fs.pathExists(skillsDir)) {
      const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith("spec-")) {
          const skillMd = path.join(skillsDir, d.name, "SKILL.md");
          if (await fs.pathExists(skillMd)) {
            existing.push(path.join(".github", "skills", d.name, "SKILL.md"));
          }
        }
      }
    }

    return existing;
  }

  async detectHarnessUsage(workspaceRoot: string) {
    return detectHarnessMarkers(workspaceRoot, {
      projectStrong: [
        path.join(".github", "copilot-instructions.md"),
        path.join(".github", "prompts"),
        path.join(".github", "agents"),
        path.join(".github", "skills"),
      ],
      userWeak: [".copilot"],
    });
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
      "  Agent files  : .github/agents/spec.<name>.agent.md  (noun-form — e.g. spec.planner)",
      "  Skill dirs   : .github/skills/spec-<name>/SKILL.md  (auto-discovered by Copilot)",
      "  Prompt files : .github/prompts/spec.<name>.prompt.md (verb-form — e.g. spec.plan)",
      "",
      "  How to use:",
      "  1. Open GitHub Copilot Chat in VS Code",
      "  2. Select an agent from the agents dropdown (e.g., spec.planner)",
      "     — or — reference a prompt file with #file or type / to browse",
      "  3. Skills are auto-discovered — just describe the task and Copilot activates the right skill",
      "  4. Agent files include handoff buttons to guide you through the pipeline",
      "  5. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 GitHub Copilot global install complete!",
      "",
      `  Agent files  : ~/.copilot/agents/spec.<name>.agent.md`,
      `  Skill dirs   : ~/.copilot/skills/spec-<name>/SKILL.md`,
      `  Prompt files : ~/.copilot/prompts/spec.<name>.prompt.md`,
      "",
      "  These are available across all your workspaces in Copilot Chat.",
      "",
    ].join("\n");
  }
}

const SPEC_LITE_MARKER_START = "<!-- spec-lite:start -->";
const SPEC_LITE_MARKER_END = "<!-- spec-lite:end -->";

/**
 * Generate the spec-lite block to inject into (or create as) copilot-instructions.md.
 * Links point to agent files (noun-form) and prompt files (verb-form).
 */
export function generateSpecLiteBlock(installedPrompts: string[], nativeSkillNames: Set<string> = new Set()): string {
  const nativeSkills = installedPrompts.filter((name) => nativeSkillNames.has(name));
  const promptFileNames = installedPrompts.filter((name) => !nativeSkillNames.has(name));

  const lines = [
    SPEC_LITE_MARKER_START,
    "## spec-lite Agents & Skills",
    "",
    "This project uses [spec-lite](https://github.com/abranjith/spec-lite) agent and skill prompts",
    "for structured software engineering workflows.",
    "",
    "The following specialist agents and skills are available:",
    "",
    "Typical flow: brainstorm → plan → feature → implement → review → document. Memory supplies standing instructions across every role.",
    "",
    "**Agent files** (`.github/agents/`) — select from the agents dropdown in Copilot Chat:",
    "",
  ];

  for (const name of installedPrompts) {
    const agentName = isPromptOnly(name)
      ? getPromptOutputName(name)
      : getAgentOutputName(name);
    lines.push(`- [spec.${agentName}](.github/agents/spec.${agentName}.agent.md)`);
  }

  if (nativeSkills.length > 0) {
    lines.push(
      "",
      "**Skill directories** (`.github/skills/`) — auto-discovered by Copilot based on task:",
      "",
    );

    for (const name of nativeSkills) {
      const dirName = getSkillDirName(name);
      lines.push(`- [${dirName}](.github/skills/${dirName}/SKILL.md)`);
    }
  }

  if (promptFileNames.length > 0) {
    lines.push(
      "",
      "**Prompt files** (`.github/prompts/`) — reference with `#file` or browse with `/`:",
      "",
    );

    for (const name of promptFileNames) {
      const promptName = getPromptOutputName(name);
      lines.push(`- [spec.${promptName}](.github/prompts/spec.${promptName}.prompt.md)`);
    }
  }

  if (hasPromptName(installedPrompts, "plan_critic")) {
    lines.push(
      "",
      "Suggested manual checkpoint after planning:",
      "",
      "- `/spec.plan_critic .spec-lite/plan.md`",
      "- `/spec.plan_critic .spec-lite/plan_<name>.md .spec-lite/brainstorm.md`",
      "- `/spec.plan_critic .spec-lite/plan_<name>.md .spec-lite/features/feature_<name>.md`",
    );
  }

  lines.push(
    "",
    "To invoke an agent, select it from the agents dropdown, reference a prompt file with `#file`,",
    "or describe the task and Copilot will auto-discover the right skill.",
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
  installedPrompts: string[],
  nativeSkillNames: Set<string> = new Set()
): string {
  const block = generateSpecLiteBlock(installedPrompts, nativeSkillNames);

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
