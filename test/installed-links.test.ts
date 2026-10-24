import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import inquirer from "inquirer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OutputScope,
  Provider,
  SourceItem,
} from "../src/providers/base.js";
import { getAllProviders } from "../src/providers/index.js";
import { initCommand } from "../src/commands/init.js";
import { updateCommand } from "../src/commands/update.js";
import { installCommand } from "../src/commands/install.js";
import { loadAllSources } from "../src/utils/prompts.js";

let root: string;
let previousCwd: string;
let sources: SourceItem[];
let selected: string[];
const cases = getAllProviders().flatMap((provider) =>
  (
    ["project", ...(provider.supportsGlobal ? ["global"] : [])] as OutputScope[]
  ).map((scope) => ({ provider, scope, label: `${provider.alias}/${scope}` }))
);

async function filesUnder(directory: string): Promise<string[]> {
  if (!(await fs.pathExists(directory))) return [];
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(absolute)));
    else files.push(absolute);
  }
  return files;
}

async function generatedFiles(provider: Provider, scope: OutputScope) {
  const files = new Set<string>();
  for (const source of sources.filter((source) =>
    selected.includes(source.name)
  )) {
    if (provider.alias === "codex" && source.kind === "reference") continue;
    const output =
      scope === "global"
        ? provider.getGlobalOutputPaths!(source.name)
        : provider.getOutputPaths(source.name);
    if (output.agent) files.add(path.resolve(root, output.agent));
    const native = source.kind === "skill" && provider.supportsNativeSkills;
    if (!native && output.prompt) files.add(path.resolve(root, output.prompt));
    if (native) {
      const dir =
        scope === "global"
          ? provider.getGlobalSkillOutputDir!(source.name)
          : provider.getSkillOutputDir!(source.name);
      for (const file of await filesUnder(path.resolve(root, dir)))
        files.add(file);
    }
  }
  for (const file of await filesUnder(
    path.join(root, ".spec-lite", "resources")
  ))
    files.add(file);
  return [...files];
}

async function assertLinksResolve(provider: Provider, scope: OutputScope) {
  const missing: string[] = [];
  let linksChecked = 0;
  for (const file of await generatedFiles(provider, scope)) {
    if (!/\.(md|toml)$/.test(file)) continue;
    expect(await fs.pathExists(file), file).toBe(true);
    const raw = await fs.readFile(file, "utf8");
    const body = provider.readOutputContent?.(raw, file) ?? raw;
    for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0];
      if (
        !target ||
        /^(?:[a-z]+:|\/)/i.test(target) ||
        /[<{]/.test(target) ||
        target.startsWith(".spec-lite/")
      )
        continue;
      linksChecked++;
      if (
        !(await fs.pathExists(
          path.resolve(path.dirname(file), decodeURIComponent(target))
        ))
      )
        missing.push(`${path.relative(root, file)} -> ${target}`);
    }
  }
  expect(linksChecked).toBeGreaterThan(0);
  expect(missing).toEqual([]);
}

beforeEach(async () => {
  previousCwd = process.cwd();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-installed-links-"));
  process.chdir(root);
  sources = await loadAllSources();
  selected = sources.map((source) => source.name);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(inquirer, "prompt").mockImplementation((async () => ({
    selectedNames: selected,
    overwrite: true,
  })) as typeof inquirer.prompt);
});

afterEach(async () => {
  process.chdir(previousCwd);
  vi.restoreAllMocks();
  expect(path.basename(root)).toMatch(/^spec-lite-installed-links-/);
  await fs.remove(root);
});

describe("REV-004: generated links", () => {
  it.each(cases)(
    "resolves all installed links after init/install and update: $label",
    async ({ provider, scope }) => {
      if (scope === "global")
        await installCommand({ global: true, ai: provider.alias, force: true });
      else
        await initCommand({
          ai: provider.alias,
          skipProfile: true,
          skipHooks: true,
          force: true,
        });
      await assertLinksResolve(provider, scope);
      if (provider.supportsNativeSkills) {
        const dir =
          scope === "global"
            ? provider.getGlobalSkillOutputDir!("review")
            : provider.getSkillOutputDir!("review");
        expect(
          await fs.readFile(path.resolve(root, dir, "SKILL.md"), "utf8")
        ).toContain("../spec-memorize/SKILL.md#memory-capture-protocol");
      }
      if (scope === "project") {
        await updateCommand({
          ai: provider.alias,
          force: true,
          skipHooks: true,
        });
        await assertLinksResolve(provider, scope);
      }
    },
    60_000
  );

  it.each(cases)(
    "bundles linked dependencies for a selected subset: $label",
    async ({ provider, scope }) => {
      selected = ["review"];
      const exclude = sources
        .filter((source) => !selected.includes(source.name))
        .map((source) => source.name)
        .join(",");
      if (scope === "global")
        await installCommand({
          global: true,
          ai: provider.alias,
          force: true,
          exclude,
        });
      else
        await initCommand({
          ai: provider.alias,
          force: true,
          skipProfile: true,
          skipHooks: true,
          exclude,
        });
      await assertLinksResolve(provider, scope);
      if (provider.supportsNativeSkills) {
        const dir =
          scope === "global"
            ? provider.getGlobalSkillOutputDir!("memorize")
            : provider.getSkillOutputDir!("memorize");
        expect(await fs.pathExists(path.resolve(root, dir))).toBe(false);
      }
      expect(
        await fs.pathExists(
          path.join(
            root,
            ".spec-lite/resources",
            provider.alias,
            "spec-memorize.md"
          )
        )
      ).toBe(true);
    },
    60_000
  );
});
