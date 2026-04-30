/**
 * Base interface for AI provider adapters.
 *
 * Each provider knows:
 * - Where to write prompt/agent files in the user's workspace (and optionally globally)
 * - How to transform raw markdown prompts into the provider's expected format
 * - How to detect existing instruction files
 */
export interface Provider {
  /** Display name of the provider */
  name: string;

  /** CLI alias used with --ai flag */
  alias: string;

  /** Short description shown in interactive picker */
  description: string;

  /** Whether this provider supports separate agent files (e.g., Copilot, Claude Code) */
  supportsAgents: boolean;

  /** Whether this provider supports native Agent Skills format (SKILL.md directories) */
  supportsNativeSkills: boolean;

  /** Whether this provider supports global (user-level) installation */
  supportsGlobal: boolean;

  /**
   * Get the output file paths for a given prompt.
   * Paths are relative to the workspace root.
   * Returns an agent path (if the provider supports agents and the prompt isn't prompt-only)
   * and a prompt path.
   */
  getOutputPaths(promptName: string): { agent?: string; prompt: string };

  /**
   * Get the global (user-level) output file paths for a given prompt.
   * Returns absolute paths. Only available when supportsGlobal is true.
   */
  getGlobalOutputPaths?(promptName: string): { agent?: string; prompt?: string };

  /**
   * Get the output directory for a skill when using native Agent Skills format.
   * Path is relative to workspace root.
   * Only used when supportsNativeSkills is true.
   */
  getSkillOutputDir?(skillName: string): string;

  /**
   * Get the global (user-level) output directory for a skill.
   * Returns absolute path. Only used when supportsNativeSkills and supportsGlobal are true.
   */
  getGlobalSkillOutputDir?(skillName: string): string;

  /**
   * Transform the raw markdown prompt content into the provider's prompt file format.
   */
  transformPrompt(content: string, meta: PromptMeta): string;

  /**
   * Transform the raw markdown prompt content into the provider's agent file format.
   * Only required when supportsAgents is true.
   */
  transformAgent?(content: string, meta: PromptMeta): string;

  /**
   * Detect existing instruction files in the workspace.
   * Returns list of relative paths that already exist.
   */
  detectExisting(workspaceRoot: string): Promise<string[]>;

  /**
   * Any post-init instructions to display to the user.
   */
  getPostInitMessage(): string;

  /**
   * Any post-global-install instructions to display to the user.
   */
  getGlobalPostInstallMessage?(): string;

  /**
   * Return the path (relative to workspace root) to an existing file that can
   * be used to seed `.spec-lite/memory.md`, along with a human-readable label.
   * Returns null if no seed source applies for this provider.
   */
  getMemorySeedSource(workspaceRoot: string): Promise<{ path: string; label: string } | null>;
}

export interface PromptMeta {
  /** Prompt file name without extension (e.g., "planner") */
  name: string;

  /** Human-readable title (e.g., "Planner Agent") */
  title: string;

  /** Brief description of what the agent does */
  description: string;
}

/**
 * Project profile collected during init questionnaire.
 * Stored in .spec-lite.json and used by the memorize bootstrap agent.
 */
export interface ProjectProfile {
  /** Programming languages used in the repository (e.g., ["TypeScript", "Python", "C#"]) */
  languages: string[];

  /** Frameworks in use (e.g., ["Express", "React"], ["FastAPI"], ["ASP.NET Core"]) */
  frameworks: string[];

  /** Testing frameworks in use (e.g., ["Jest", "Vitest", "pytest", "xUnit"]) */
  testFrameworks: string[];

  /** Architectural patterns present in the repository (e.g., ["Monolith"], ["Microservices", "Serverless"]) */
  architectures: string[];

  /** Additional coding conventions (e.g., "Airbnb style guide", "PEP 8") */
  conventions: string;
}

/**
 * Config file written to the workspace root to track installed state.
 */
export interface SpecLiteConfig {
  version: string;
  /** Format version: "v1" (legacy prompts/) or "v2" (agents/skills/references) */
  format?: string;
  /** Primary provider alias (legacy compatibility) */
  provider: string;
  /** All configured provider aliases for this workspace */
  providers?: string[];
  installedPrompts: string[];
  installedAt: string;
  updatedAt: string;
  projectProfile?: ProjectProfile;
}

/**
 * Config file written to ~/.spec-lite/global-config.json to track global install state.
 */
export interface SpecLiteGlobalConfig {
  version: string;
  /** Primary provider alias (legacy compatibility) */
  provider: string;
  /** All configured provider aliases for global install */
  providers?: string[];
  installedPrompts: string[];
  installedAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Source item types for the new agents/skills/references structure
// ---------------------------------------------------------------------------

/** The kind of source item: agent, skill, or reference. */
export type SourceItemKind = "agent" | "skill" | "reference";

/**
 * Parsed frontmatter from an AGENT.md or SKILL.md file.
 */
export interface SourceFrontmatter {
  name: string;
  description: string;
  metadata?: Record<string, string>;
  license?: string;
  compatibility?: string;
  "allowed-tools"?: string;
}

/**
 * A loaded source item — either an agent, skill, or reference.
 * This is the unified type that replaces PromptFile for the new structure.
 */
export interface SourceItem {
  /** The kind: agent, skill, or reference */
  kind: SourceItemKind;

  /** Internal name (folder name for agents/skills, filename without ext for references) */
  name: string;

  /** Absolute path to the root directory (for agents/skills) or file (for references) */
  rootPath: string;

  /** Parsed YAML frontmatter (agents/skills only) */
  frontmatter?: SourceFrontmatter;

  /** The assembled markdown content (AGENT.md/SKILL.md body + inlined references) */
  content: string;

  /** Human-readable title */
  title: string;

  /** Brief description */
  description: string;

  /** Verb-form name for prompt/command files */
  promptName: string;

  /** Noun-form name for agent files */
  agentName: string;

  /** If true, only a prompt file is created (no agent file in non-Copilot providers) */
  promptOnly: boolean;
}
