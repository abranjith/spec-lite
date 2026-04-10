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
  provider: string;
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
  provider: string;
  installedPrompts: string[];
  installedAt: string;
  updatedAt: string;
}
