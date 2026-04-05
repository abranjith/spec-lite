import path from "path";
import os from "os";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";
import { getAgentOutputName, getPromptOutputName, isPromptOnly } from "../utils/prompts.js";

// ---------------------------------------------------------------------------
// Handoffs map — derived from the orchestrator pipeline.
// Each key is an *internal* prompt name and the value is an ordered list of
// suggested next-step handoffs.  The `agent` field uses the "spec.<agentName>"
// convention (noun-form, matching the .agent.md file).
// ---------------------------------------------------------------------------

interface Handoff {
  label: string;
  agent: string;
  prompt: string;
}

const AGENT_HANDOFFS: Record<string, Handoff[]> = {
  spec_help: [],
  brainstorm: [
    {
      label: "Create Plan",
      agent: "spec.planner",
      prompt: "Create a detailed technical plan based on the brainstorm above.",
    },
    {
      label: "Capture Conventions",
      agent: "spec.memorize",
      prompt: "Bootstrap memory from the project context established in the brainstorm.",
    },
  ],
  planner: [
    {
      label: "Break Down Features",
      agent: "spec.feature",
      prompt: "Break the plan into individual feature specification files.",
    },
    {
      label: "Design Architecture",
      agent: "spec.architect",
      prompt: "Create a detailed cloud and infrastructure architecture for the plan.",
    },
    {
      label: "Design Data Model",
      agent: "spec.data_modeller",
      prompt: "Design a detailed data model based on the plan.",
    },
    {
      label: "Capture Conventions",
      agent: "spec.memorize",
      prompt: "Bootstrap memory from the plan's tech stack and conventions.",
    },
    {
      label: "Track Enhancement",
      agent: "spec.todo",
      prompt: "Add this out-of-scope enhancement to .spec-lite/TODO.md under the right category.",
    },
  ],
  architect: [
    {
      label: "Break Down Features",
      agent: "spec.feature",
      prompt: "Break the plan into individual feature specification files.",
    },
    {
      label: "Design Data Model",
      agent: "spec.data_modeller",
      prompt: "Design a detailed data model based on the architecture.",
    },
    {
      label: "Set Up Infrastructure",
      agent: "spec.devops",
      prompt: "Set up Docker, CI/CD, and deployment infrastructure based on the architecture.",
    },
  ],
  feature: [
    {
      label: "Implement Feature",
      agent: "spec.implementer",
      prompt: "Implement the feature spec produced above.",
    },
    {
      label: "Write Unit Tests",
      agent: "spec.unit_tester",
      prompt: "Write unit tests for the feature spec produced above.",
    },
    {
      label: "Track Enhancement",
      agent: "spec.todo",
      prompt: "Add this out-of-scope enhancement to .spec-lite/TODO.md under the right category.",
    },
  ],
  implement: [
    {
      label: "Write Unit Tests",
      agent: "spec.unit_tester",
      prompt: "Write comprehensive unit tests for the code just implemented.",
    },
    {
      label: "Review Code",
      agent: "spec.code_reviewer",
      prompt: "Review the code just implemented for correctness, architecture, and readability.",
    },
    {
      label: "Write Integration Tests",
      agent: "spec.integration_tester",
      prompt: "Write integration test scenarios for the feature just implemented.",
    },
  ],
  unit_tests: [
    {
      label: "Review Code",
      agent: "spec.code_reviewer",
      prompt: "Review the implementation and tests for correctness, architecture, and readability.",
    },
    {
      label: "Write Integration Tests",
      agent: "spec.integration_tester",
      prompt: "Write integration test scenarios to complement the unit tests.",
    },
  ],
  code_review: [
    {
      label: "Fix Issues",
      agent: "spec.fixer",
      prompt: "Fix the issues identified in the code review above.",
    },
    {
      label: "Security Audit",
      agent: "spec.security_auditor",
      prompt: "Run a security audit on the code reviewed above.",
    },
  ],
  integration_tests: [
    {
      label: "Security Audit",
      agent: "spec.security_auditor",
      prompt: "Run a security audit on the features covered by integration tests.",
    },
    {
      label: "Performance Review",
      agent: "spec.performance_reviewer",
      prompt: "Review performance of the features covered by integration tests.",
    },
  ],
  performance_review: [
    {
      label: "Fix Critical Issues",
      agent: "spec.fixer",
      prompt: "Fix the critical performance issues identified in the review above.",
    },
    {
      label: "Security Audit",
      agent: "spec.security_auditor",
      prompt: "Run a security audit alongside the performance improvements.",
    },
  ],
  security_audit: [
    {
      label: "Fix Vulnerabilities",
      agent: "spec.fixer",
      prompt: "Fix the vulnerabilities and security issues identified in the audit above.",
    },
    {
      label: "Update README",
      agent: "spec.write_readme",
      prompt: "Update the README to reflect the hardened security posture.",
    },
  ],
  fix: [
    {
      label: "Review Fix",
      agent: "spec.code_reviewer",
      prompt: "Review the fix applied above for correctness and regressions.",
    },
    {
      label: "Write Regression Tests",
      agent: "spec.unit_tester",
      prompt: "Write regression tests to cover the bug fixed above.",
    },
  ],
  memorize: [
    {
      label: "Create Plan",
      agent: "spec.planner",
      prompt: "Create a technical plan for the project using the conventions captured in memory.",
    },
    {
      label: "Design Data Model",
      agent: "spec.data_modeller",
      prompt: "Design a data model using the conventions captured in memory.",
    },
    {
      label: "Add Feature",
      agent: "spec.feature",
      prompt: "Define a feature specification using the conventions captured in memory.",
    },
    {
      label: "Explore Codebase",
      agent: "spec.explorer",
      prompt: "Explore the codebase to discover conventions and document the architecture.",
    },
  ],

  readme: [
    {
      label: "Set Up DevOps",
      agent: "spec.devops",
      prompt: "Set up Docker, CI/CD, and deployment infrastructure for this project.",
    },
    {
      label: "Security Audit",
      agent: "spec.security_auditor",
      prompt: "Run a final security audit before releasing the project.",
    },
  ],
  devops: [
    {
      label: "Security Audit",
      agent: "spec.security_auditor",
      prompt: "Run a security audit on the infrastructure and deployment configuration.",
    },
    {
      label: "Update README",
      agent: "spec.write_readme",
      prompt: "Update the README with deployment and infrastructure instructions.",
    },
  ],
  data_modeller: [
    {
      label: "Break Down Features",
      agent: "spec.feature",
      prompt: "Break down features using the data model as the authoritative schema reference.",
    },
    {
      label: "Implement Data Layer",
      agent: "spec.implementer",
      prompt: "Implement the data layer (migrations, models, repositories) from the data model.",
    },
    {
      label: "Capture Conventions",
      agent: "spec.memorize",
      prompt: "Capture data modelling conventions in project memory.",
    },
  ],
  yolo: [
    {
      label: "Resume YOLO",
      agent: "spec.yolo",
      prompt: "Resume YOLO from where we left off.",
    },
    {
      label: "Check Pipeline Status",
      agent: "spec.help",
      prompt: "Show me the current spec-lite pipeline status and available sub-agents.",
    },
  ],
  explore: [
    {
      label: "Capture Conventions",
      agent: "spec.memorize",
      prompt: "Refine the conventions discovered during exploration.",
    },
    {
      label: "Create Plan",
      agent: "spec.planner",
      prompt: "Create a technical plan based on the explored codebase.",
    },
    {
      label: "Code Review",
      agent: "spec.code_reviewer",
      prompt: "Review the improvement areas identified during exploration.",
    },
    {
      label: "Security Audit",
      agent: "spec.security_auditor",
      prompt: "Audit the security risks identified during exploration.",
    },
  ],
  plan_feature: [
    {
      label: "Implement Feature",
      agent: "spec.implementer",
      prompt: "Implement the feature spec produced above.",
    },
    {
      label: "Track Enhancement",
      agent: "spec.todo",
      prompt: "Add this out-of-scope enhancement to .spec-lite/TODO.md under the right category.",
    },
  ],
  tool_help: [
    {
      label: "Implement Feature",
      agent: "spec.implementer",
      prompt: "Implement the feature, using the tools created above where applicable.",
    },
    {
      label: "Capture Conventions",
      agent: "spec.memorize",
      prompt: "Capture tool usage conventions in project memory.",
    },
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
      "  Agent files  : .github/agents/spec.<name>.agent.md  (noun-form — e.g. spec.planner)",
      "  Prompt files : .github/prompts/spec.<name>.prompt.md (verb-form — e.g. spec.plan)",
      "",
      "  How to use:",
      "  1. Open GitHub Copilot Chat in VS Code",
      "  2. Select a sub-agent from the agents dropdown (e.g., spec.planner)",
      "     — or — reference a prompt file with #file or type / to browse",
      "  3. Agent files include handoff buttons to guide you through the pipeline",
      "  4. Customize the Project Context block in each file for your project",
      "",
    ].join("\n");
  }

  getGlobalPostInstallMessage(): string {
    return [
      "",
      "📋 GitHub Copilot global install complete!",
      "",
      `  Agent files  : ~/.copilot/agents/spec.<name>.agent.md`,
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
export function generateSpecLiteBlock(installedPrompts: string[]): string {
  const lines = [
    SPEC_LITE_MARKER_START,
    "## spec-lite Sub-Agents",
    "",
    "This project uses [spec-lite](https://github.com/abranjith/spec-lite) sub-agent prompts",
    "for structured software engineering workflows.",
    "",
    "The following specialist sub-agents are available:",
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

  lines.push(
    "",
    "**Prompt files** (`.github/prompts/`) — reference with `#file` or browse with `/`:",
    "",
  );

  for (const name of installedPrompts) {
    const promptName = getPromptOutputName(name);
    lines.push(`- [spec.${promptName}](.github/prompts/spec.${promptName}.prompt.md)`);
  }

  lines.push(
    "",
    "To invoke a sub-agent, select it from the agents dropdown or use `#file` to reference a prompt file.",
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
