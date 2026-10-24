import path from "node:path";
import { createHash } from "node:crypto";
import fs from "fs-extra";
import chalk from "chalk";
import type { Provider } from "../providers/base.js";
import { extractProjectContext } from "./prompts.js";
import type { LegacyRename } from "./stale-sources.js";

/** Read Markdown context from the logical content, not its serialized representation. */
export function extractOutputContext(
  provider: Provider,
  content: string,
  outputPath: string
): string | null {
  return extractProjectContext(
    provider.readOutputContent?.(content, outputPath) ?? content
  );
}

const comparable = (value: string | null) =>
  value?.replace(/\r\n/g, "\n").trim() ?? "";

/** Shared project/global context selection and per-output migration validation. */
export class OutputPreservation {
  private expected = new Map<string, string | null>();
  private conflicts = new Set<string>();

  constructor(
    private provider: Provider,
    private root: string,
    private renames: LegacyRename[],
    private force: boolean
  ) {}

  private absolute(file: string): string {
    return path.resolve(this.root, file);
  }

  async contextFor(
    outputPath: string,
    defaultContent: string,
    fallbackContext: string | null = null
  ): Promise<string | null> {
    const absolute = this.absolute(outputPath);
    const legacy = this.renames.find(
      (rename) => this.absolute(rename.outputFile) === absolute
    );
    const defaults = extractProjectContext(defaultContent);
    let context: string | null = null;
    if (!this.force) {
      context = (await fs.pathExists(absolute))
        ? extractOutputContext(
            this.provider,
            await fs.readFile(absolute, "utf8"),
            absolute
          )
        : null;
      const legacyContext = legacy?.contextBlock ?? fallbackContext;
      if (legacyContext !== null) {
        const destinationCustomized =
          !!comparable(context) && comparable(context) !== comparable(defaults);
        const legacyCustomized =
          !!comparable(legacyContext) &&
          comparable(legacyContext) !== comparable(defaults);
        if (!destinationCustomized) {
          context = legacyContext;
        } else if (
          legacyCustomized &&
          comparable(context) !== comparable(legacyContext) &&
          legacy
        ) {
          this.conflicts.add(legacy.legacyPath);
          console.log(
            chalk.yellow(
              `  Kept ${legacy.legacyPath}: its Project Context conflicts with ${outputPath}. Merge the two copies before removing the old file.`
            )
          );
        }
      }
    }
    this.expected.set(absolute, context ?? defaults);
    return context;
  }

  /** Only retire originals whose actual replacement was written and retains the chosen context. */
  async removableRenames(): Promise<LegacyRename[]> {
    const removable: LegacyRename[] = [];
    for (const rename of this.renames) {
      const output = this.absolute(rename.outputFile);
      if (this.conflicts.has(rename.legacyPath) || !this.expected.has(output)) {
        continue;
      }
      const actual = extractOutputContext(
        this.provider,
        await fs.readFile(output, "utf8"),
        output
      );
      if (
        comparable(actual) !== comparable(this.expected.get(output) ?? null)
      ) {
        throw new Error(`Replacement context validation failed: ${output}`);
      }
      removable.push(rename);
    }
    return removable;
  }
}

/** Keep a verified, content-addressed copy before retiring an original. */
export async function backupAndRemoveLegacy(
  root: string,
  rename: LegacyRename
): Promise<void> {
  const absolute = path.resolve(root, rename.legacyPath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Refusing to remove path outside installation root: ${absolute}`
    );
  }
  const original = await fs.readFile(absolute);
  if (original.toString("utf8") !== rename.originalContent) {
    throw new Error(`Legacy file changed during migration; kept ${absolute}`);
  }
  const digest = createHash("sha256").update(original).digest("hex");
  const backup = path.join(
    root,
    ".spec-lite",
    "backups",
    "naming",
    digest,
    relative
  );
  await fs.ensureDir(path.dirname(backup));
  await fs.copy(absolute, backup, { overwrite: false });
  if (!(await fs.readFile(backup)).equals(original)) {
    throw new Error(`Legacy backup validation failed; kept ${absolute}`);
  }
  await fs.remove(absolute);
  console.log(chalk.dim(`    Backup: ${backup}`));
}
