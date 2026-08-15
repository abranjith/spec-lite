import { describe, expect, it } from "vitest";
import { AGENT_HANDOFFS } from "../src/providers/copilot.js";
import { PROMPT_NAMES } from "../src/utils/prompts.js";

describe("Copilot handoffs", () => {
  it("only uses real source keys and real agent targets", () => {
    const sourceNames = new Set(Object.keys(PROMPT_NAMES));
    const agentNames = new Set(
      Object.values(PROMPT_NAMES).map(({ agentName }) => `spec.${agentName}`),
    );
    const invalidKeys = Object.keys(AGENT_HANDOFFS).filter(
      (name) => !sourceNames.has(name),
    );
    const invalidTargets = Object.entries(AGENT_HANDOFFS).flatMap(
      ([source, handoffs]) =>
        handoffs
          .filter(({ agent }) => !agentNames.has(agent))
          .map(({ agent }) => `${source} -> ${agent}`),
    );

    expect(invalidKeys).toEqual([]);
    expect(invalidTargets).toEqual([]);
  });
});
