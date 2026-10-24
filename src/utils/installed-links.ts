import path from "node:path";
import fs from "fs-extra";
import type { OutputScope, Provider, SourceItem } from "../providers/base.js";
import { toSpecName } from "./naming.js";

function mainFile(source: SourceItem): string {
  return source.kind === "reference"
    ? source.rootPath
    : path.join(
        source.rootPath,
        source.kind === "skill" ? "SKILL.md" : "AGENT.md"
      );
}

interface LinkTarget {
  output: string;
  supporting: boolean;
}

/** Resolve bundled links against actual installed paths, including selected subsets. */
export class InstalledLinks {
  private mains = new Map<string, LinkTarget>();
  private nativeDirectories = new Map<string, string>();
  private pending = new Map<string, string>();
  private resources: string;

  constructor(
    provider: Provider,
    root: string,
    private allSources: SourceItem[],
    selected: SourceItem[],
    scope: OutputScope
  ) {
    this.resources = path.join(root, ".spec-lite", "resources", provider.alias);
    const selectedNames = new Set(selected.map((source) => source.name));
    for (const source of allSources) {
      const paths =
        scope === "global"
          ? (provider.getGlobalOutputPaths?.(source.name) ?? {})
          : provider.getOutputPaths(source.name);
      const native =
        source.kind === "skill" && provider.supportsNativeSkills
          ? scope === "global"
            ? provider.getGlobalSkillOutputDir?.(source.name)
            : provider.getSkillOutputDir?.(source.name)
          : undefined;
      const installed =
        selectedNames.has(source.name) &&
        !(provider.alias === "codex" && source.kind === "reference");
      const primary = native
        ? path.join(native, "SKILL.md")
        : (paths.agent ?? paths.prompt);
      const output =
        installed && primary
          ? path.resolve(root, primary)
          : path.join(this.resources, `${toSpecName(source.name)}.md`);
      this.mains.set(path.resolve(mainFile(source)), {
        output,
        supporting: !installed || !primary,
      });
      if (installed && native)
        this.nativeDirectories.set(source.rootPath, path.resolve(root, native));
    }
  }

  rewrite(source: SourceItem, content: string, outputFile: string): string {
    return this.rewriteFile(content, mainFile(source), outputFile);
  }

  rewriteFile(content: string, sourceFile: string, outputFile: string): string {
    return content.replace(
      /(!?\[[^\]]*\]\()([^)]+)(\))/g,
      (match, open: string, raw: string, close: string) => {
        if (
          /^(?:[a-z]+:|\/|#)/i.test(raw) ||
          raw.startsWith(".spec-lite/") ||
          /[<{]/.test(raw)
        )
          return match;
        const anchorAt = raw.indexOf("#");
        const file = anchorAt < 0 ? raw : raw.slice(0, anchorAt);
        const anchor = anchorAt < 0 ? "" : raw.slice(anchorAt);
        let decoded: string;
        try {
          decoded = decodeURIComponent(file);
        } catch {
          return match;
        }
        const absolute = path.resolve(path.dirname(sourceFile), decoded);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile())
          return match;
        let target = this.mains.get(absolute);
        if (!target) {
          const owner = this.allSources.find(
            (source) =>
              source.kind !== "reference" &&
              absolute.startsWith(source.rootPath + path.sep)
          );
          if (!owner) return match;
          const relative = path.relative(owner.rootPath, absolute);
          const native = this.nativeDirectories.get(owner.rootPath);
          target = {
            output: native
              ? path.join(native, relative)
              : path.join(this.resources, toSpecName(owner.name), relative),
            supporting: !native,
          };
        }
        if (target.supporting) this.pending.set(absolute, target.output);
        const relative = path
          .relative(path.dirname(path.resolve(outputFile)), target.output)
          .split(path.sep)
          .join("/");
        return `${open}${relative}${anchor}${close}`;
      }
    );
  }

  /** Materialize only referenced support files; recursively rewrite their links too. */
  async writeSupportingFiles(): Promise<void> {
    const written = new Set<string>();
    for (const [source, output] of this.pending) {
      if (written.has(source)) continue;
      written.add(source);
      await fs.ensureDir(path.dirname(output));
      if (source.endsWith(".md")) {
        const content = this.rewriteFile(
          await fs.readFile(source, "utf8"),
          source,
          output
        );
        await fs.writeFile(output, content, "utf8");
      } else {
        await fs.copy(source, output);
      }
    }
  }
}
