import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import inquirer from "inquirer";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAllProviders, getProvider } from "../src/providers/index.js";
import type {
  OutputScope,
  Provider,
  SourceItem,
} from "../src/providers/base.js";
import { updateCommand } from "../src/commands/update.js";
import { installCommand } from "../src/commands/install.js";
import {
  copyNativeSkillDir,
  extractProjectContext,
  loadAllSources,
  replaceProjectContext,
} from "../src/utils/prompts.js";
import {
  backupAndRemoveLegacy,
  extractOutputContext,
  OutputPreservation,
} from "../src/utils/output-preservation.js";
import { resolveLegacyRenames } from "../src/utils/stale-sources.js";

let root: string;
let originalCwd: string;
let sources: SourceItem[];
let selection: string[];
let removeLegacy: boolean;
const providers = getAllProviders();
const globals = providers.filter((provider) => provider.supportsGlobal);
const custom = "\n## Project Context\nCUSTOM café 漢字 🚀 C:\\tools\\build\n";

function configuration(provider: string) {
  return {
    version: "0.4.3",
    format: "v2",
    provider,
    providers: [provider],
    installedPrompts: sources.map((source) => source.name),
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    documentation: {
      directory: "docs",
      level: "technical",
      updateWithDevelopment: false,
    },
  };
}

function render(
  provider: Provider,
  source: SourceItem,
  file: string,
  context: string | null
) {
  const meta = {
    name: source.promptName,
    title: source.title,
    description: source.description,
  };
  const body =
    context !== null
      ? replaceProjectContext(source.content, context)
      : source.content;
  return file.endsWith(".agent.md") ||
    (file.includes(`${path.sep}agents${path.sep}`) && file.endsWith(".md"))
    ? provider.transformAgent!(body, meta)
    : provider.transformPrompt(body, meta);
}

async function writeConfig(provider: Provider) {
  await fs.writeJson(
    path.join(root, ".spec-lite.json"),
    configuration(provider.alias)
  );
}

function pathsFor(provider: Provider, source: SourceItem, scope: OutputScope) {
  const before = provider.getLegacyOutputPaths!(source.name, scope);
  const after =
    scope === "global"
      ? provider.getGlobalOutputPaths!(source.name)
      : provider.getOutputPaths(source.name);
  return { before, after };
}

async function seedPlanner(
  provider: Provider,
  scope: OutputScope,
  oldContext: string,
  newContext?: string | null
) {
  const source = sources.find((source) => source.name === "plan")!;
  const { before, after } = pathsFor(provider, source, scope);
  const legacy = path.resolve(root, (before.agent ?? before.prompt)!);
  const destination = path.resolve(root, (after.agent ?? after.prompt)!);
  const original = render(provider, source, legacy, oldContext);
  await fs.outputFile(legacy, original);
  if (newContext !== undefined)
    await fs.outputFile(
      destination,
      render(provider, source, destination, newContext)
    );
  return { source, legacy, destination, original };
}

async function run(provider: Provider, scope: OutputScope, force = false) {
  if (scope === "global")
    await installCommand({ global: true, ai: provider.alias, force });
  else {
    await writeConfig(provider);
    await updateCommand({ ai: provider.alias, skipHooks: true, force });
  }
}

async function readContext(provider: Provider, file: string) {
  return extractOutputContext(provider, await fs.readFile(file, "utf8"), file);
}

async function backupContents(
  directory = path.join(root, ".spec-lite", "backups", "naming")
): Promise<string[]> {
  if (!(await fs.pathExists(directory))) return [];
  const contents: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) contents.push(...(await backupContents(file)));
    else contents.push(await fs.readFile(file, "utf8"));
  }
  return contents;
}

beforeEach(async () => {
  originalCwd = process.cwd();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-lite-safe-migration-"));
  process.chdir(root);
  sources = await loadAllSources();
  selection = ["plan"];
  removeLegacy = true;
  vi.spyOn(os, "homedir").mockReturnValue(root);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(inquirer, "prompt").mockImplementation((async (
    questions: Array<{ name: string }>
  ) => {
    const answers: Record<string, unknown> = {};
    for (const question of questions) {
      if (question.name === "selectedNames") answers[question.name] = selection;
      else if (question.name === "removeLegacy")
        answers[question.name] = removeLegacy;
      else if (["overwrite", "removeStale"].includes(question.name))
        answers[question.name] = true;
      else throw new Error(`Unexpected prompt ${question.name}`);
    }
    return answers;
  }) as typeof inquirer.prompt);
});

afterEach(async () => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  expect(path.basename(root)).toMatch(/^spec-lite-safe-migration-/);
  await fs.remove(root);
});

describe("REV-001: global preservation", () => {
  it.each(globals.map((provider) => [provider.alias, provider] as const))(
    "preserves every global output for %s",
    async (_alias, provider) => {
      const expected: Array<{
        file: string;
        context: string;
        original?: string;
      }> = [];
      for (const source of sources) {
        if (provider.alias === "codex" && source.kind === "reference") continue;
        const { before, after } = pathsFor(provider, source, "global");
        const native = source.kind === "skill" && provider.supportsNativeSkills;
        // Claude only acquired native skills in 0.5.0; the other providers already used them.
        if (native && provider.alias !== "claude-code") {
          const dir = provider.getGlobalSkillOutputDir!(source.name);
          const ctx = `${custom}${source.name}-skill\n`;
          await copyNativeSkillDir(source.rootPath, dir, { contextBlock: ctx });
          await fs.outputFile(
            path.join(dir, "user-resource.txt"),
            "KEEP-RESOURCE"
          );
          expected.push({ file: path.join(dir, "SKILL.md"), context: ctx });
        }
        for (const key of ["agent", "prompt"] as const) {
          if (key === "prompt" && native && provider.alias !== "claude-code")
            continue;
          const legacy = before[key],
            destination = after[key];
          if (!legacy || !destination) continue;
          const ctx = `${custom}${source.name}-${key}\n`;
          const original = render(provider, source, legacy, ctx);
          await fs.outputFile(legacy, original);
          if (extractProjectContext(source.content) !== null)
            expected.push({ file: destination, context: ctx, original });
          if (native && provider.alias === "claude-code" && key === "agent") {
            expected.push({
              file: path.join(
                provider.getGlobalSkillOutputDir!(source.name),
                "SKILL.md"
              ),
              context: ctx,
            });
          }
        }
      }
      await run(provider, "global");
      for (const output of expected) {
        expect(await readContext(provider, output.file), output.file).toBe(
          output.context
        );
        if (output.original)
          expect(await backupContents()).toContain(output.original);
        if (
          path.basename(output.file) === "SKILL.md" &&
          provider.alias !== "claude-code"
        )
          expect(
            await fs.readFile(
              path.join(path.dirname(output.file), "user-resource.txt"),
              "utf8"
            )
          ).toBe("KEEP-RESOURCE");
      }
      // Reinstalling must preserve context even after the old names are gone.
      await run(provider, "global");
      for (const output of expected)
        expect(await readContext(provider, output.file)).toBe(output.context);
    },
    60_000
  );
});

describe.each(["project", "global"] as const)(
  "REV-002: %s collisions",
  (scope) => {
    const applicable = scope === "global" ? globals : providers;
    it.each(applicable.map((provider) => [provider.alias, provider] as const))(
      "keeps conflicting originals and allows a reconciled retry for %s",
      async (_alias, provider) => {
        const fixture = await seedPlanner(
          provider,
          scope,
          custom,
          "\nDESTINATION-ONLY\n"
        );
        await run(provider, scope);
        expect(await fs.readFile(fixture.legacy, "utf8")).toBe(
          fixture.original
        );
        expect(await readContext(provider, fixture.destination)).toBe(
          "\nDESTINATION-ONLY\n"
        );
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining("conflicts")
        );
        await fs.writeFile(
          fixture.legacy,
          render(
            provider,
            fixture.source,
            fixture.legacy,
            "\nDESTINATION-ONLY\n"
          )
        );
        await run(provider, scope);
        expect(await fs.pathExists(fixture.legacy)).toBe(false);
        expect(await backupContents()).toContain(
          render(
            provider,
            fixture.source,
            fixture.legacy,
            "\nDESTINATION-ONLY\n"
          )
        );
      },
      60_000
    );

    it.each(applicable.map((provider) => [provider.alias, provider] as const))(
      "inherits legacy context over a default destination for %s",
      async (_alias, provider) => {
        const fixture = await seedPlanner(provider, scope, custom, null);
        await run(provider, scope);
        expect(await readContext(provider, fixture.destination)).toBe(custom);
        expect(await fs.pathExists(fixture.legacy)).toBe(false);
        expect(await backupContents()).toContain(fixture.original);
      },
      60_000
    );
  }
);

it.each([true, false])(
  "handles a Claude command-to-skill collision (custom destination: %s)",
  async (customized) => {
    const provider = getProvider("claude-code")!;
    const source = sources.find((source) => source.name === "implement")!;
    selection = [source.name];
    const legacy = provider.getLegacyOutputPaths!(
      source.name,
      "project"
    ).prompt!;
    const destination = path.join(
      root,
      provider.getSkillOutputDir!(source.name),
      "SKILL.md"
    );
    const original = render(provider, source, legacy, custom);
    await fs.outputFile(legacy, original);
    await copyNativeSkillDir(source.rootPath, path.dirname(destination), {
      contextBlock: customized ? "\nDESTINATION\n" : null,
    });
    await run(provider, "project");
    expect(await readContext(provider, destination)).toBe(
      customized ? "\nDESTINATION\n" : custom
    );
    expect(await fs.pathExists(legacy)).toBe(customized);
    if (!customized) expect(await backupContents()).toContain(original);
  }
);

describe("REV-003: decoded Codex round trips", () => {
  it.each([
    "\nTriple literal: '''quoted'''\nC:\\tools\\build café 漢字 🚀\n",
    '\nTriple basic: """quoted""" and \\\\server\\share\n',
    "\r\nBoth: ''' and \"\"\"\r\nTab\tBackspace\b Formfeed\f\r\n",
  ])("round-trips legacy TOML and ordinary updates: %j", async (ctx) => {
    const provider = getProvider("codex")!;
    const fixture = await seedPlanner(provider, "project", ctx);
    const body = replaceProjectContext(fixture.source.content, ctx);
    // Independent basic-string fixture exercises decoding regardless of provider serializer choices.
    const original = `name = "spec.planner"\ndescription = "Legacy"\ndeveloper_instructions = ${JSON.stringify(body)}\n`;
    await fs.writeFile(fixture.legacy, original);
    expect(parseToml(original).developer_instructions).toBe(body);
    await run(provider, "project");
    const doc = parseToml(await fs.readFile(fixture.destination, "utf8"));
    expect(extractProjectContext(String(doc.developer_instructions))).toBe(ctx);
    expect(doc.name).toBe("spec-planner");
    expect(await fs.pathExists(fixture.legacy)).toBe(false);
    expect(await backupContents()).toContain(original);
    await run(provider, "project");
    expect(await readContext(provider, fixture.destination)).toBe(ctx);
  });

  it("reads legacy literal multiline strings", async () => {
    const provider = getProvider("codex")!;
    const fixture = await seedPlanner(provider, "project", custom);
    const body = replaceProjectContext(fixture.source.content, custom);
    await fs.writeFile(
      fixture.legacy,
      `name = "spec.planner"\ndeveloper_instructions = '''\n${body}\n'''\n`
    );
    await run(provider, "project");
    expect(await readContext(provider, fixture.destination)).toBe(custom);
  });

  it("does not write or remove originals when legacy TOML is malformed", async () => {
    const provider = getProvider("codex")!;
    const fixture = await seedPlanner(provider, "project", custom);
    await fs.writeFile(fixture.legacy, "developer_instructions = '''unclosed");
    await expect(run(provider, "project")).rejects.toThrow();
    expect(await fs.readFile(fixture.legacy, "utf8")).toBe(
      "developer_instructions = '''unclosed"
    );
    expect(await fs.pathExists(fixture.destination)).toBe(false);
  });

  it("serializes quotes at string boundaries without corrupting content", () => {
    const provider = getProvider("codex")!;
    const content = "''' \"\"\" beginning\nend\"\"\"'''";
    const raw = provider.transformPrompt(content, {
      name: "plan",
      title: "Plan",
      description: "quotes",
    });
    expect(parseToml(raw).developer_instructions).toBe(content);
    expect(
      parseToml(stringifyToml({ developer_instructions: content }))
        .developer_instructions
    ).toBe(content);
  });
});

describe("cleanup safety", () => {
  it("retains the complete legacy file when cleanup is declined", async () => {
    const provider = getProvider("generic")!;
    const fixture = await seedPlanner(provider, "project", custom);
    removeLegacy = false;
    await run(provider, "project");
    expect(await fs.readFile(fixture.legacy, "utf8")).toBe(fixture.original);
    expect(await readContext(provider, fixture.destination)).toBe(custom);
    expect(await backupContents()).toEqual([]);
  });

  it("retains originals if a destination cannot be read/written", async () => {
    const provider = getProvider("claude-code")!;
    const fixture = await seedPlanner(provider, "project", custom);
    await fs.ensureDir(fixture.destination);
    await expect(run(provider, "project")).rejects.toThrow();
    expect(await fs.readFile(fixture.legacy, "utf8")).toBe(fixture.original);
  });

  it("backs up even deliberately overwritten context with --force", async () => {
    const provider = getProvider("generic")!;
    const fixture = await seedPlanner(provider, "project", custom);
    await run(provider, "project", true);
    expect(await readContext(provider, fixture.destination)).not.toBe(custom);
    expect(await backupContents()).toContain(fixture.original);
  });

  it("refuses to remove a legacy file changed after the snapshot", async () => {
    const provider = getProvider("generic")!;
    const fixture = await seedPlanner(provider, "project", custom);
    const renames = await resolveLegacyRenames(
      root,
      provider,
      [fixture.source],
      "project"
    );
    await fs.appendFile(fixture.legacy, "NEW-EDIT");
    await expect(backupAndRemoveLegacy(root, renames[0])).rejects.toThrow(
      "changed during migration"
    );
    expect(await fs.readFile(fixture.legacy, "utf8")).toContain("NEW-EDIT");
  });

  it("validates the written replacement before declaring a migration complete", async () => {
    const provider = getProvider("generic")!;
    const fixture = await seedPlanner(provider, "project", custom);
    const renames = await resolveLegacyRenames(
      root,
      provider,
      [fixture.source],
      "project"
    );
    const preservation = new OutputPreservation(provider, root, renames, false);
    await preservation.contextFor(fixture.destination, fixture.source.content);
    await fs.outputFile(
      fixture.destination,
      render(provider, fixture.source, fixture.destination, "\nWRONG\n")
    );
    await expect(preservation.removableRenames()).rejects.toThrow(
      "validation failed"
    );
    expect(await fs.readFile(fixture.legacy, "utf8")).toBe(fixture.original);
  });
});
