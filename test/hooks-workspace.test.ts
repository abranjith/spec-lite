import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { buildPayload } from "../src/hooks/payload.js";
import { nextFeatureNumber, resolveFeature } from "../src/hooks/workspace.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-hooks-workspace-"));
});

afterEach(async () => {
  await fs.remove(root);
});

async function writeFeatureDir(dirName: string, id: string): Promise<void> {
  const dir = path.join(root, ".spec-lite", "features", dirName);
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, "spec.md"), `**ID**: ${id}\n`, "utf-8");
}

describe("legacy plan-feature IDs", () => {
  it("resolves a FEAT-FP directory by its case-insensitive full ID", async () => {
    await writeFeatureDir("FEAT-FP-007-focused_search", "FEAT-FP-007");

    await expect(resolveFeature(root, "feat-fp-007")).resolves.toEqual({
      id: "FEAT-FP-007",
      name: "focused_search",
      dir: ".spec-lite/features/FEAT-FP-007-focused_search",
      spec: ".spec-lite/features/FEAT-FP-007-focused_search/spec.md",
    });
  });

  it("includes the resolved FEAT-FP location in feature-related hook payloads", async () => {
    await writeFeatureDir("FEAT-FP-007-focused_search", "FEAT-FP-007");

    const payload = await buildPayload({
      root,
      event: "plan-feature.post",
      featureId: "FEAT-FP-007",
      provider: "generic",
    });

    expect(payload.feature).toMatchObject({
      id: "FEAT-FP-007",
      name: "focused_search",
      dir: ".spec-lite/features/FEAT-FP-007-focused_search",
      spec: ".spec-lite/features/FEAT-FP-007-focused_search/spec.md",
    });
  });

  it("includes legacy FEAT-FP suffixes when allocating the next canonical feature number", async () => {
    await writeFeatureDir("FEAT-FP-007-focused_search", "FEAT-FP-007");
    await writeFeatureDir("FEAT-003-user_management", "FEAT-003");

    await expect(nextFeatureNumber(root)).resolves.toBe(8);
  });
});
