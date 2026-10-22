import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { getAllProviders } from "../src/providers/index.js";
import { AGENT_HANDOFFS } from "../src/providers/copilot.js";
import { loadAllSources } from "../src/utils/prompts.js";
import { getAgentsDir } from "../src/utils/agents.js";
import { getSkillsDir } from "../src/utils/skills.js";
import { parseFrontmatter } from "../src/utils/frontmatter.js";
import {
  isAgentSkillsName,
  legacySpecName,
  toSpecName,
} from "../src/utils/naming.js";

/** Strip the provider's file extension to get the name the harness sees. */
function outputName(file: string): string {
  return path
    .basename(file)
    .replace(/(\.agent\.md|\.prompt\.md|\.toml|\.md)$/, "");
}

describe("Agent Skills naming (https://agentskills.io/specification)", () => {
  it("validates names against the spec", () => {
    expect(isAgentSkillsName("spec-plan-critic")).toBe(true);
    expect(isAgentSkillsName("spec.plan_critic")).toBe(false);
    expect(isAgentSkillsName("Spec-plan")).toBe(false);
    expect(isAgentSkillsName("spec--plan")).toBe(false);
    expect(isAgentSkillsName("-spec")).toBe(false);
    expect(isAgentSkillsName("a".repeat(65))).toBe(false);
    expect(toSpecName("plan_critic")).toBe("spec-plan-critic");
    expect(toSpecName("spec.plan_critic")).toBe("spec-plan-critic");
    expect(legacySpecName("plan-critic")).toBe("spec.plan_critic");
  });

  it("gives every installed output, frontmatter name and handoff a compliant name", async () => {
    const sources = await loadAllSources();
    const invalid: string[] = [];
    const check = (label: string, name: string) => {
      if (!isAgentSkillsName(name)) invalid.push(`${label}: ${name}`);
    };

    for (const provider of getAllProviders()) {
      for (const source of sources) {
        const label = `${provider.alias}/${source.name}`;
        for (const paths of [
          provider.getOutputPaths(source.name),
          provider.getGlobalOutputPaths?.(source.name) ?? {},
        ]) {
          if (paths.agent) check(`${label} agent`, outputName(paths.agent));
          if (paths.prompt) check(`${label} prompt`, outputName(paths.prompt));
        }
        for (const dir of [
          provider.getSkillOutputDir?.(source.name),
          provider.getGlobalSkillOutputDir?.(source.name),
        ]) {
          if (dir) check(`${label} skill dir`, path.basename(dir));
        }

        const meta = {
          name: source.promptName,
          title: source.title,
          description: source.description,
        };
        for (const rendered of [
          provider.transformPrompt(source.content, meta),
          provider.transformAgent?.(source.content, meta),
        ]) {
          if (!rendered) continue;
          // Throws on malformed YAML (e.g. an unquoted "WARNING: ..." description).
          const { data } = parseFrontmatter(rendered);
          const name = (data as { name?: unknown }).name;
          if (name !== undefined) check(`${label} frontmatter`, String(name));
          const tomlName = /^name = "([^"]*)"$/m.exec(rendered);
          if (tomlName) check(`${label} toml`, tomlName[1]);
        }

        // Agent files must declare the name the harness registers them under.
        const agentPath = provider.getOutputPaths(source.name).agent;
        if (agentPath && provider.transformAgent) {
          const { data } = parseFrontmatter(
            provider.transformAgent(source.content, meta)
          );
          const { name, description } = data as {
            name?: string;
            description?: string;
          };
          if (name !== outputName(agentPath))
            invalid.push(`${label} agent frontmatter name: ${name}`);
          if (!description) invalid.push(`${label} agent description missing`);
        }
      }
    }

    for (const [source, handoffs] of Object.entries(AGENT_HANDOFFS)) {
      for (const { agent } of handoffs) check(`handoff ${source}`, agent);
    }

    expect(invalid).toEqual([]);
  });

  it("names every bundled agent and skill after its directory with a valid description", async () => {
    const problems: string[] = [];
    for (const [root, file] of [
      [getAgentsDir(), "AGENT.md"],
      [getSkillsDir(), "SKILL.md"],
    ] as const) {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const raw = await fs.readFile(
          path.join(root, entry.name, file),
          "utf8"
        );
        const { data } = parseFrontmatter(raw);
        const { name, description } = data as {
          name?: string;
          description?: string;
        };
        if (name !== entry.name) problems.push(`${entry.name}: name ${name}`);
        if (!isAgentSkillsName(toSpecName(entry.name)))
          problems.push(`${entry.name}: installed name`);
        const length = description?.trim().length ?? 0;
        if (length < 1 || length > 1024)
          problems.push(`${entry.name}: description length ${length}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
