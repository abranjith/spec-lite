import inquirer from "inquirer";
import type {
  DocumentationLevel,
  DocumentationSettings,
} from "../providers/base.js";

export const DEFAULT_DOCUMENTATION_SETTINGS: Readonly<DocumentationSettings> = {
  directory: "docs",
  level: "technical",
  updateWithDevelopment: false,
};

export function normalizeDocumentationDirectory(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function validateDocumentationDirectory(value: string): true | string {
  const normalized = normalizeDocumentationDirectory(value);
  if (!normalized || normalized === ".") {
    return "Enter a repository-relative documentation directory (for example, docs).";
  }
  if (/^(?:\/|[A-Za-z]:)/.test(normalized)) {
    return "Documentation directory must be repository-relative.";
  }
  if (normalized.split("/").includes("..")) {
    return "Documentation directory cannot leave the repository.";
  }
  return true;
}

export async function collectDocumentationSettings(): Promise<DocumentationSettings> {
  const answers = await inquirer.prompt<{
    directory: string;
    level: DocumentationLevel;
    updateWithDevelopment: boolean;
  }>([
    {
      type: "input",
      name: "directory",
      message: "Documentation directory?",
      default: "docs",
      validate: validateDocumentationDirectory,
      filter: normalizeDocumentationDirectory,
    },
    {
      type: "list",
      name: "level",
      message: "Documentation level?",
      choices: [
        {
          name: "Technical — architecture and design documentation",
          value: "technical",
        },
        {
          name: "Full — technical docs plus quickstart, usage, and feature docs",
          value: "full",
        },
      ],
      default: "technical",
    },
    {
      type: "confirm",
      name: "updateWithDevelopment",
      message: "Keep documentation updated during implementation and fixes?",
      default: true,
    },
  ]);

  return {
    directory: normalizeDocumentationDirectory(answers.directory),
    level: answers.level,
    updateWithDevelopment: answers.updateWithDevelopment,
  };
}
