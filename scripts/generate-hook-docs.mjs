// Regenerates the marker-delimited hook tables in docs/features/hooks.md from
// the code. Run via `npm run generate:hook-docs` after changing
// INTERPOLATION_VARS or EVENT_CATALOG. A test asserts the doc matches, so CI
// catches drift.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  renderVarsTable,
  renderEventsTable,
  replaceBetweenMarkers,
  VARS_TABLE_START,
  VARS_TABLE_END,
  EVENTS_TABLE_START,
  EVENTS_TABLE_END,
} from "../src/hooks/docs.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docPath = path.join(__dirname, "..", "docs", "features", "hooks.md");

let content = readFileSync(docPath, "utf-8");

const withVars = replaceBetweenMarkers(content, VARS_TABLE_START, VARS_TABLE_END, renderVarsTable());
if (withVars === null) {
  console.error(`Missing ${VARS_TABLE_START} / ${VARS_TABLE_END} markers in ${docPath}`);
  process.exit(1);
}

const withEvents = replaceBetweenMarkers(withVars, EVENTS_TABLE_START, EVENTS_TABLE_END, renderEventsTable());
if (withEvents === null) {
  console.error(`Missing ${EVENTS_TABLE_START} / ${EVENTS_TABLE_END} markers in ${docPath}`);
  process.exit(1);
}

writeFileSync(docPath, withEvents, "utf-8");
console.log(`Wrote hook tables to ${docPath}`);
