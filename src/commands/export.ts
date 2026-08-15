import path from "node:path";
import fs from "fs-extra";
import matter from "gray-matter";
import inquirer from "inquirer";
import chalk from "chalk";
import type { ProjectProfile, SourceItem, SourceItemKind, SpecLiteConfig } from "../providers/base.js";
import { loadAllSources, normalizePromptName, replaceProjectContext } from "../utils/prompts.js";
import { buildGroupedSourceChoices } from "../utils/source-selection.js";
import { buildProjectContextBlock } from "./init.js";
import { getPackageVersion } from "../utils/package-version.js";

const SPEC_LITE_VERSION = getPackageVersion();

export interface ExportOptions {
  all?: boolean;
  output?: string;
  references?: boolean;
}

function sourceMainFile(source: SourceItem): string {
  if (source.kind === "reference") return source.rootPath;
  return path.join(source.rootPath, source.kind === "agent" ? "AGENT.md" : "SKILL.md");
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function anchorSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function getExportAnchor(source: SourceItem): string {
  return `${source.kind}-${anchorSlug(source.promptName)}`;
}

function sourceAliases(source: SourceItem): string[] {
  return [source.name, source.promptName]
    .map(normalizePromptName)
    .filter(Boolean);
}

/** Resolve CLI names with stable input ordering and strict unknown-name errors. */
export function resolveExportSources(
  allSources: SourceItem[],
  names: string[],
  includeAll: boolean,
  includeReferences = true,
): SourceItem[] {
  let selected: SourceItem[];
  if (includeAll) {
    selected = allSources.filter((source) => includeReferences || source.kind !== "reference");
  } else {
    const byAlias = new Map<string, SourceItem>();
    for (const source of allSources) {
      for (const alias of sourceAliases(source)) byAlias.set(alias, source);
    }

    const unknown: string[] = [];
    selected = [];
    for (const name of names) {
      const source = byAlias.get(normalizePromptName(name));
      if (!source) unknown.push(name);
      else if (!selected.includes(source)) selected.push(source);
    }

    if (unknown.length > 0) {
      const valid = allSources.map((source) => source.name).sort().join(", ");
      throw new Error(`Unknown export name(s): ${unknown.join(", ")}. Valid names: ${valid}`);
    }
  }

  const orchestrator = selected.find((source) => source.name === "orchestrator");
  return orchestrator
    ? [orchestrator, ...selected.filter((source) => source !== orchestrator)]
    : selected;
}

/** Rewrite every local Markdown link so the combined document is self-contained. */
export function rewriteExportLinks(
  content: string,
  source: SourceItem,
  allSources: SourceItem[],
  selectedSources: SourceItem[],
): string {
  const allByPath = new Map(
    allSources.map((item) => [canonicalPath(sourceMainFile(item)), item]),
  );
  const selectedSet = new Set(selectedSources);
  const currentFile = sourceMainFile(source);

  return content.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (match, label: string, rawTarget: string) => {
    let target = rawTarget.trim();
    if (/^(?:[a-z]+:|#)/i.test(target)) return match;
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    const pathPart = target.split("#", 1)[0];
    if (!pathPart) return match;

    const absoluteTarget = canonicalPath(path.resolve(path.dirname(currentFile), pathPart));
    const linkedSource = allByPath.get(absoluteTarget);
    if (linkedSource && selectedSet.has(linkedSource)) {
      return `[${label}](#${getExportAnchor(linkedSource)})`;
    }
    if (linkedSource) return `${label} (not included in this export)`;

    const sourceRoot = source.kind === "reference" ? path.dirname(source.rootPath) : source.rootPath;
    const relativeToSource = path.relative(sourceRoot, absoluteTarget);
    if (!relativeToSource.startsWith("..") && !path.isAbsolute(relativeToSource)) {
      return `${label} (included in this section)`;
    }
    return `${label} (not included in this export)`;
  });
}

function kindLabel(kind: SourceItemKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

async function projectProfileForExport(workspaceRoot: string): Promise<ProjectProfile | undefined> {
  const configPath = path.join(workspaceRoot, ".spec-lite.json");
  if (!(await fs.pathExists(configPath))) return undefined;
  const config = await fs.readJson(configPath) as Partial<SpecLiteConfig>;
  return config.projectProfile;
}

export async function buildCombinedExport(
  selectedSources: SourceItem[],
  allSources: SourceItem[],
  projectProfile?: ProjectProfile,
  generatedDate = new Date().toISOString().slice(0, 10),
): Promise<string> {
  const lines = [
    `<!-- Generated by spec-lite v${SPEC_LITE_VERSION} | export | ${generatedDate} -->`,
    "",
    "# spec-lite — Combined Prompts",
    "",
    "> Invoke a section by name, for example: “Act according to the Review skill below.”",
  ];

  if (selectedSources.length > 1) {
    lines.push(
      "> Each section is an independent role. Follow exactly one role per request unless the Orchestrator explicitly coordinates several roles.",
    );
  }

  lines.push("", "## Table of Contents", "");
  for (const [label, kind] of [
    ["Agents", "agent"],
    ["Skills", "skill"],
    ["References", "reference"],
  ] as [string, SourceItemKind][]) {
    const group = selectedSources.filter((source) => source.kind === kind);
    if (group.length === 0) continue;
    lines.push(`- **${label}**`);
    for (const source of group) {
      lines.push(`  - [${source.title}](#${getExportAnchor(source)})`);
    }
  }

  for (const source of selectedSources) {
    let body = matter(source.content).content;
    if (projectProfile) {
      body = replaceProjectContext(body, buildProjectContextBlock(projectProfile));
    }
    body = rewriteExportLinks(body, source, allSources, selectedSources).trim();

    lines.push(
      "",
      "---",
      "",
      `<a id="${getExportAnchor(source)}"></a>`,
      `# ${kindLabel(source.kind)}: ${source.title}`,
      "",
      `> **Name:** \`${source.promptName}\` · **Description:** ${source.description}`,
      "",
      body,
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

export async function exportCommand(names: string[], options: ExportOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const allSources = await loadAllSources();
    let selectedNames = names;

    if (!options.all && selectedNames.length === 0) {
      const answer = await inquirer.prompt<{ selectedNames: string[] }>([
        {
          type: "checkbox",
          name: "selectedNames",
          message: "Select agents, skills, and references to export:",
          choices: buildGroupedSourceChoices(allSources),
          pageSize: 24,
          validate: (input: string[]) => input.length > 0 || "Select at least one item.",
        },
      ]);
      selectedNames = answer.selectedNames;
    }

    const selectedSources = resolveExportSources(
      allSources,
      selectedNames,
      !!options.all,
      options.references !== false,
    );
    const profile = await projectProfileForExport(cwd);
    const output = await buildCombinedExport(selectedSources, allSources, profile);
    const outputPath = options.output ?? "spec-lite-prompts.md";

    if (outputPath === "-") {
      process.stdout.write(output);
      return;
    }

    const absoluteOutput = path.resolve(cwd, outputPath);
    await fs.ensureDir(path.dirname(absoluteOutput));
    await fs.writeFile(absoluteOutput, output, "utf8");
    console.log(chalk.green(`Exported ${selectedSources.length} item(s) to ${path.relative(cwd, absoluteOutput) || absoluteOutput}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(message));
    process.exitCode = 1;
  }
}
