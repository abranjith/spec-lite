import type { Provider } from "./base.js";
import { CopilotProvider } from "./copilot.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { GenericProvider } from "./generic.js";
import { PiProvider } from "./pi.js";

/**
 * Registry of all supported AI provider adapters.
 */
const providers: Provider[] = [
  new CopilotProvider(),
  new ClaudeCodeProvider(),
  new PiProvider(),
  new GenericProvider(),
];

/**
 * Get a provider by its CLI alias (e.g., "copilot", "claude-code", "generic").
 */
export function getProvider(alias: string): Provider | undefined {
  return providers.find((p) => p.alias === alias);
}

/**
 * Get all registered providers.
 */
export function getAllProviders(): Provider[] {
  return [...providers];
}

/**
 * Get a formatted list of provider aliases for display.
 */
export function getProviderAliases(): string[] {
  return providers.map((p) => p.alias);
}

// Re-export types
export type { Provider, PromptMeta, SpecLiteConfig } from "./base.js";
