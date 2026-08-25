import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { buildHooksSchema } from "../src/hooks/schema.js";

describe("schema/hooks.schema.json does not drift from src/hooks/schema.ts", () => {
  it("matches the generated object exactly", async () => {
    const onDisk = await fs.readJson(path.resolve(__dirname, "..", "schema", "hooks.schema.json"));
    expect(onDisk).toEqual(buildHooksSchema());
  });
});
