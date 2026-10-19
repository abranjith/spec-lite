// Regenerates the marker-delimited hook tables and JSON blocks in the hook
// pages under docs/features/ from the code. Run via `npm run generate:hook-docs`
// after changing INTERPOLATION_VARS, EVENT_CATALOG, BUILTIN_HOOKS, or
// BUILTIN_OPTIONS. A test asserts the docs match, so CI catches drift.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GENERATED_BLOCKS, replaceBetweenMarkers } from "../src/hooks/docs.ts";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const byFile = new Map();
for (const block of GENERATED_BLOCKS) {
  byFile.set(block.file, [...(byFile.get(block.file) ?? []), block]);
}

for (const [file, blocks] of byFile) {
  const docPath = path.join(repoRoot, file);
  let content = readFileSync(docPath, "utf-8");
  for (const { start, end, render } of blocks) {
    content = replaceBetweenMarkers(content, start, end, render());
    if (content === null) {
      console.error(`Missing ${start} / ${end} markers in ${docPath}`);
      process.exit(1);
    }
  }
  writeFileSync(docPath, content, "utf-8");
  console.log(`Wrote ${blocks.length} hook block(s) to ${file}`);
}
