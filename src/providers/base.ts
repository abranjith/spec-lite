/**
 * Base interface for AI provider adapters.
 *
 * Each provider knows:
 * - Where to write prompt files in the user's workspace
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

  /**
   * Get the target file path for a given prompt.
   * Path is relative to the workspace root.
   */
  getTargetPath(promptName: string): string;

  /**
   * Transform the raw markdown prompt content into the provider's expected format.
   */
  transformPrompt(content: string, meta: PromptMeta): string;

  /**
   * Detect existing instruction files in the workspace.
   * Returns list of relative paths that already exist.
   */
  detectExisting(workspaceRoot: string): Promise<string[]>;

  /**
   * Any post-init instructions to display to the user.
   */
  getPostInitMessage(): string;
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
  /** Primary programming language (e.g., "TypeScript", "Python", "C#") */
  language: string;

  /** Framework(s) in use (e.g., "Express + React", "FastAPI", "ASP.NET Core") */
  frameworks: string;

  /** Testing framework (e.g., "Jest", "Vitest", "pytest", "xUnit") */
  testFramework: string;

  /** Architectural pattern (e.g., "Monolith", "Microservices", "Serverless") */
  architecture: string;

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
