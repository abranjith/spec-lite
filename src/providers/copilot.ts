import path from "path";
import fs from "fs-extra";
import type { Provider, PromptMeta } from "./base.js";

// ---------------------------------------------------------------------------
// Handoffs map — derived from the orchestrator pipeline.
// Each key is a prompt name and the value is an ordered list of suggested
// next-step handoffs.  Agent identifiers use the "spec.<name>" convention
// (matching the file name without the ".agent.md" suffix).
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
      label: "Capture Conventions",
      agent: "spec.memorize",
      prompt: "Bootstrap memory from the plan's tech stack and conventions.",
    },
  ],
  architect: [
    {
      label: "Break Down Features",
      agent: "spec.feature",
      prompt: "Break the plan into individual feature specification files.",
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
      agent: "spec.implement",
      prompt: "Implement the feature spec produced above.",
    },
    {
      label: "Write Unit Tests",
      agent: "spec.unit_tests",
      prompt: "Write unit tests for the feature spec produced above.",
    },
  ],
  implement: [
    {
      label: "Write Unit Tests",
      agent: "spec.unit_tests",
      prompt: "Write comprehensive unit tests for the code just implemented.",
    },
    {
      label: "Review Code",
      agent: "spec.code_review",
      prompt: "Review the code just implemented for correctness, architecture, and readability.",
    },
    {
      label: "Write Integration Tests",
      agent: "spec.integration_tests",
      prompt: "Write integration test scenarios for the feature just implemented.",
    },
  ],
  unit_tests: [
    {
      label: "Review Code",
      agent: "spec.code_review",
      prompt: "Review the implementation and tests for correctness, architecture, and readability.",
    },
    {
      label: "Write Integration Tests",
      agent: "spec.integration_tests",
      prompt: "Write integration test scenarios to complement the unit tests.",
    },
  ],
  code_review: [
    {
      label: "Fix Issues",
      agent: "spec.fix",
      prompt: "Fix the issues identified in the code review above.",
    },
    {
      label: "Security Audit",
      agent: "spec.security_audit",
      prompt: "Run a security audit on the code reviewed above.",
    },
    {
      label: "Write Technical Docs",
      agent: "spec.technical_docs",
      prompt: "Write technical documentation for the reviewed code.",
    },
  ],
  integration_tests: [
    {
      label: "Security Audit",
      agent: "spec.security_audit",
      prompt: "Run a security audit on the features covered by integration tests.",
    },
    {
      label: "Performance Review",
      agent: "spec.performance_review",
      prompt: "Review performance of the features covered by integration tests.",
    },
    {
      label: "Write Technical Docs",
      agent: "spec.technical_docs",
      prompt: "Write technical documentation for the features covered by integration tests.",
    },
  ],
  performance_review: [
    {
      label: "Fix Critical Issues",
      agent: "spec.fix",
      prompt: "Fix the critical performance issues identified in the review above.",
    },
    {
      label: "Security Audit",
      agent: "spec.security_audit",
      prompt: "Run a security audit alongside the performance improvements.",
    },
    {
      label: "Write Technical Docs",
      agent: "spec.technical_docs",
      prompt: "Write technical documentation capturing the performance findings and fixes.",
    },
  ],
  security_audit: [
    {
      label: "Fix Vulnerabilities",
      agent: "spec.fix",
      prompt: "Fix the vulnerabilities and security issues identified in the audit above.",
    },
    {
      label: "Write Technical Docs",
      agent: "spec.technical_docs",
      prompt: "Write technical documentation capturing the security findings and mitigations.",
    },
    {
      label: "Update README",
      agent: "spec.readme",
      prompt: "Update the README to reflect the hardened security posture.",
    },
  ],
  fix: [
    {
      label: "Review Fix",
      agent: "spec.code_review",
      prompt: "Review the fix applied above for correctness and regressions.",
    },
    {
      label: "Write Regression Tests",
      agent: "spec.unit_tests",
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
      label: "Add Feature",
      agent: "spec.feature",
      prompt: "Define a feature specification using the conventions captured in memory.",
    },
  ],
  technical_docs: [
    {
      label: "Update README",
      agent: "spec.readme",
      prompt: "Write or update the project README based on the technical docs produced above.",
    },
    {
      label: "Set Up DevOps",
      agent: "spec.devops",
      prompt: "Set up deployment infrastructure to complement the documented architecture.",
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
      agent: "spec.security_audit",
      prompt: "Run a final security audit before releasing the project.",
    },
  ],
  devops: [
    {
      label: "Security Audit",
      agent: "spec.security_audit",
      prompt: "Run a security audit on the infrastructure and deployment configuration.",
    },
    {
      label: "Update README",
      agent: "spec.readme",
      prompt: "Update the README with deployment and infrastructure instructions.",
    },
    {
      label: "Update Technical Docs",
      agent: "spec.technical_docs",
      prompt: "Update the technical documentation to include the DevOps setup.",
    },
  ],
};

/**
 * Build the YAML frontmatter block for a .agent.md file.
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
 *  - `.github/agents/spec.<name>.agent.md`  — custom agent files (with frontmatter + handoffs)
 *  - `.github/prompts/<name>.prompt.md`     — prompt files (plain markdown, for slash-command use)
 *
 * Plus a `.github/copilot-instructions.md` that references the prompt files.
 */
export class CopilotProvider implements Provider {
  name = "GitHub Copilot";
  alias = "copilot";
  description = "GitHub Copilot (VS Code, JetBrains, Neovim)";

  /** Primary target: the .agent.md file in .github/agents/ */
  getTargetPath(promptName: string): string {
    return path.join(".github", "agents", `spec.${promptName}.agent.md`);
  }

  /** Transform content into an agent file: YAML frontmatter + prompt body. */
  transformPrompt(content: string, meta: PromptMeta): string {
    return buildAgentFrontmatter(meta) + content;
  }

  /**
   * Transform content into a prompt file (no frontmatter — just the managed-file
   * header comment followed by the prompt body).
   */
  transformPromptFile(content: string, meta: PromptMeta): string {
    const header = [
      `<!-- spec-lite | ${meta.name} | DO NOT EDIT below the project-context block — managed by spec-lite -->`,
      `<!-- To update: run "spec-lite update" — your Project Context edits will be preserved -->`,
      "",
    ].join("\n");
    return header + content;
  }

  /** Returns the path for the companion .prompt.md file */
  getPromptFilePath(promptName: string): string {
    return path.join(".github", "prompts", `${promptName}.prompt.md`);
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
        if (f.endsWith(".prompt.md")) {
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
      "  Agent files  : .github/agents/spec.<name>.agent.md",
      "  Prompt files : .github/prompts/<name>.prompt.md",
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
}

const SPEC_LITE_MARKER_START = "<!-- spec-lite:start -->";
const SPEC_LITE_MARKER_END = "<!-- spec-lite:end -->";

/**
 * Generate the spec-lite block to inject into (or create as) copilot-instructions.md.
 * Links point to the prompt files in .github/prompts/.
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
    lines.push(`- [spec.${name}](.github/agents/spec.${name}.agent.md)`);
  }

  lines.push(
    "",
    "**Prompt files** (`.github/prompts/`) — reference with `#file` or browse with `/`:",
    "",
  );

  for (const name of installedPrompts) {
    lines.push(`- [${name}](.github/prompts/${name}.prompt.md)`);
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
