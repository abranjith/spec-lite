import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Resolve package metadata from either source modules or the bundled CLI. */
export function getPackageVersion(): string {
  for (const candidate of ["../package.json", "../../package.json"]) {
    try {
      return (require(candidate) as { version: string }).version;
    } catch {
      // Source modules and the single-file bundle have different relative depths.
    }
  }
  return "unknown";
}
