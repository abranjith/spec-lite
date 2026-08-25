import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderVarsTable,
  renderEventsTable,
  extractBetweenMarkers,
  VARS_TABLE_START,
  VARS_TABLE_END,
  EVENTS_TABLE_START,
  EVENTS_TABLE_END,
} from "../src/hooks/docs.js";
import { INTERPOLATION_VARS } from "../src/hooks/interpolation.js";
import { EVENT_CATALOG } from "../src/hooks/events.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docPath = path.join(repoRoot, "docs", "features", "hooks.md");

async function hooksDoc(): Promise<string> {
  return fs.readFile(docPath, "utf-8");
}

describe("docs/features/hooks.md tables do not drift from the code", () => {
  it("has both marker pairs", async () => {
    const content = await hooksDoc();
    expect(content).toContain(VARS_TABLE_START);
    expect(content).toContain(VARS_TABLE_END);
    expect(content).toContain(EVENTS_TABLE_START);
    expect(content).toContain(EVENTS_TABLE_END);
  });

  it("interpolation table matches INTERPOLATION_VARS", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), VARS_TABLE_START, VARS_TABLE_END);
    expect(
      embedded,
      "hooks.md vars table is stale — run `npm run generate:hook-docs`"
    ).toBe(renderVarsTable());
  });

  it("event table matches EVENT_CATALOG", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), EVENTS_TABLE_START, EVENTS_TABLE_END);
    expect(
      embedded,
      "hooks.md events table is stale — run `npm run generate:hook-docs`"
    ).toBe(renderEventsTable());
  });

  it("documents every interpolation variable, with no extras", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), VARS_TABLE_START, VARS_TABLE_END) ?? "";
    for (const v of INTERPOLATION_VARS) {
      expect(embedded, `\${${v.name}} is missing from the hooks.md table`).toContain(`\`\${${v.name}}\``);
    }
    // `${env:NAME}` is documented as a row but is not a table entry, so the
    // doc carries exactly one more row than INTERPOLATION_VARS.
    const rowCount = embedded.split("\n").filter((l) => l.startsWith("| `")).length;
    expect(rowCount).toBe(INTERPOLATION_VARS.length + 1);
  });

  it("documents every catalog event", async () => {
    const embedded = extractBetweenMarkers(await hooksDoc(), EVENTS_TABLE_START, EVENTS_TABLE_END) ?? "";
    for (const e of EVENT_CATALOG) {
      expect(embedded, `${e.name} is missing from the hooks.md event table`).toContain(`\`${e.name}\``);
    }
  });
});
