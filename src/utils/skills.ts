import path from "path";
import fs from "fs-extra";
import matter from "gray-matter";
import { fileURLToPath } from "url";
import type { SourceItem, SourceFrontmatter } from "../providers/base.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the bundled skills directory (shipped with the npm package) */
export function getSkillsDir(): string {
  return path.resolve(__dirname, "..", "skills");
}

/**
 * Load a single skill from its directory.
 * Reads SKILL.md, parses frontmatter, and assembles content with inlined references/assets.
 */
export async function loadSkill(skillDir: string): Promise<SourceItem | null> {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!(await fs.pathExists(skillMdPath))) return null;

  const raw = await fs.readFile(skillMdPath, "utf-8");
  const { data, content: body } = matter(raw);
  const frontmatter = data as SourceFrontmatter;
  const name = path.basename(skillDir);

  // Assemble: body + inlined references and assets
  const assembled = await assembleContent(skillDir, body);

  return {
    kind: "skill",
    name,
    rootPath: skillDir,
    frontmatter,
    content: assembled,
    title: frontmatter.metadata?.title ?? formatTitle(name),
    description: frontmatter.description ?? "",
    promptName: name.replace(/-/g, "_"),
    agentName: name.replace(/-/g, "_"),
    promptOnly: false,
  };
}

/**
 * Load all skills from the bundled skills directory.
 */
export async function loadAllSkills(): Promise<SourceItem[]> {
  const skillsDir = getSkillsDir();
  if (!(await fs.pathExists(skillsDir))) return [];

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skills: SourceItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = await loadSkill(path.join(skillsDir, entry.name));
    if (skill) skills.push(skill);
  }

  return skills;
}

/**
 * Assemble the content from a skill directory.
 * Reads the main body and appends content from references/ and assets/ files
 * that are referenced in the body via relative links.
 */
async function assembleContent(rootDir: string, body: string): Promise<string> {
  let assembled = body;

  // Find all relative file references in the markdown: [text](references/...) or [text](assets/...)
  const refPattern = /\[([^\]]*)\]\(((?:references|assets)\/[^)]+)\)/g;
  const referencedFiles = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(body)) !== null) {
    referencedFiles.add(match[2]);
  }

  // Inline referenced files that exist and are small enough (< 100 lines)
  for (const relPath of referencedFiles) {
    const absPath = path.join(rootDir, relPath);
    if (!(await fs.pathExists(absPath))) continue;

    const refContent = await fs.readFile(absPath, "utf-8");
    const lineCount = refContent.split("\n").length;

    if (lineCount <= 100) {
      // Inline: replace the link with the content
      const linkPattern = new RegExp(
        `\\[([^\\]]*)\\]\\(${escapeRegex(relPath)}\\)`,
        "g"
      );
      assembled = assembled.replace(linkPattern, () => {
        return `${refContent.trim()}`;
      });
    } else {
      // Append as a section at the end
      assembled += `\n\n---\n\n${refContent.trim()}\n`;
    }
  }

  return assembled;
}

function formatTitle(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
