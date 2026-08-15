import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import type { HarnessDetection, HarnessDetectionSignal } from "../providers/base.js";

export interface HarnessMarkers {
  projectStrong?: string[];
  projectWeak?: string[];
  userWeak?: string[];
  commands?: string[];
}

async function commandOnPath(command: string): Promise<boolean> {
  const pathValue = process.env.PATH;
  if (!pathValue) return false;

  const suffixes = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      if (await fs.pathExists(path.join(directory, `${command}${suffix.toLowerCase()}`))) return true;
      if (suffix && await fs.pathExists(path.join(directory, `${command}${suffix.toUpperCase()}`))) return true;
    }
  }
  return false;
}

async function collectPaths(
  root: string,
  markers: string[],
  scope: HarnessDetectionSignal["scope"],
  strength: HarnessDetectionSignal["strength"],
): Promise<HarnessDetectionSignal[]> {
  const signals: HarnessDetectionSignal[] = [];
  for (const marker of markers) {
    if (await fs.pathExists(path.join(root, marker))) {
      signals.push({ scope, strength, marker });
    }
  }
  return signals;
}

/** Detect project and user signals for one coding harness. */
export async function detectHarnessMarkers(
  workspaceRoot: string,
  markers: HarnessMarkers,
): Promise<HarnessDetection> {
  const signals = [
    ...await collectPaths(workspaceRoot, markers.projectStrong ?? [], "project", "strong"),
    ...await collectPaths(workspaceRoot, markers.projectWeak ?? [], "project", "weak"),
    ...await collectPaths(os.homedir(), markers.userWeak ?? [], "user", "weak"),
  ];

  for (const command of markers.commands ?? []) {
    if (await commandOnPath(command)) {
      signals.push({ scope: "user", strength: "weak", marker: `${command} on PATH` });
    }
  }

  return { detected: signals.length > 0, signals };
}
