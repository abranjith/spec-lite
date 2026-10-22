import { stringify } from "yaml";
import { normalizePromptName } from "./prompts.js";

/**
 * Output naming shared by every provider.
 *
 * Installed agents, skills, prompts and commands all follow the Agent Skills
 * naming rules (https://agentskills.io/specification): lowercase letters,
 * digits and single hyphens, at most 64 characters. Some coding agents reject
 * anything else, so the same `spec-<name>` form is used everywhere.
 */

const AGENT_SKILLS_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AGENT_SKILLS_NAME_MAX = 64;

/** e.g. "plan_critic" / "plan-critic" / "spec.plan_critic" → "spec-plan-critic" */
export function toSpecName(name: string): string {
  return `spec-${normalizePromptName(name).replace(/_/g, "-")}`;
}

/** Pre-0.5.0 dotted form (e.g. "spec.plan_critic"), used only to migrate old installs. */
export function legacySpecName(name: string): string {
  return `spec.${normalizePromptName(name)}`;
}

/** Whether a file or directory name carries the current (`spec-`) or legacy (`spec.`) prefix. */
export function hasSpecPrefix(name: string): boolean {
  return name.startsWith("spec-") || name.startsWith("spec.");
}

/** Whether a name satisfies the Agent Skills `name` constraints. */
export function isAgentSkillsName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= AGENT_SKILLS_NAME_MAX &&
    AGENT_SKILLS_NAME.test(name)
  );
}

/** Render a YAML frontmatter block, quoting values wherever YAML requires it. */
export function yamlFrontmatter(fields: Record<string, unknown>): string {
  const body = stringify(fields, { lineWidth: 0 }).trimEnd();
  return `---\n${body}\n---\n`;
}
