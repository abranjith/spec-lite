// After build, inspect npm's actual inclusion list. Git excludes do not protect npm packages.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function assertPackageContents(files) {
  const invalid = files.map((entry) => typeof entry === "string" ? entry : entry.path).filter((file) => {
    const value = file.replace(/\\/g, "/");
    return /(?:^|\/)(?:hooks\.log\.jsonl|debug\.log|feedback\.md|audit\.jsonl|intent\.json|control\.lock)$/.test(value)
      || /(?:^|\/)(?:decisions|actions|executions|events|chains|threads|owners|workflows)\/(?:[adewxc]-[a-z0-9-]+)(?:\/|\.json$)/.test(value)
      || /(?:^|\/)(?:tmp|locks)\//.test(value)
      || /(?:^|\/)spec-lite\/(?:workflows|decisions|actions|executions|events|chains|threads|logs|tmp|locks)\//.test(value);
  });
  if (invalid.length) throw new Error(`Runtime artifacts in npm package: ${invalid.join(", ")}`);
  return files.length;
}

export function assertPackOutput(output) {
  // npm <=11 returns an array; newer npm returns a map keyed by package name.
  if (!output || typeof output !== "object") {
    throw new Error("Invalid npm pack output: expected an array or package-name map.");
  }
  const packages = Array.isArray(output) ? output : Object.values(output);
  if (!packages.length || packages.some((item) => !item || !Array.isArray(item.files))) {
    throw new Error("Invalid npm pack output: expected packages with file lists.");
  }
  let count = 0;
  for (const item of packages) count += assertPackageContents(item.files);
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // npm-cli.js avoids shell re-parsing and npm.cmd on Windows.
  const npmCli = process.env.npm_execpath;
  const invocation = npmCli ? [process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"]] : process.platform === "win32" ? [process.execPath, [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), "pack", "--dry-run", "--json", "--ignore-scripts"]] : ["npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]];
  const output = JSON.parse(execFileSync(invocation[0], invocation[1], { encoding: "utf8", windowsHide: true }));
  const count = assertPackOutput(output);
  console.log(`Package policy passed (${count} files; no runtime artifacts).`);
}
