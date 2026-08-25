// Regenerates schema/hooks.schema.json from src/hooks/schema.ts.
// Run via `npm run generate:hooks-schema` after any change to the schema source.
// Executed with tsx so it reads TypeScript source directly — no build required.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildHooksSchema } from "../src/hooks/schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "schema", "hooks.schema.json");
writeFileSync(out, JSON.stringify(buildHooksSchema(), null, 2) + "\n", "utf-8");
console.log(`Wrote ${out}`);
