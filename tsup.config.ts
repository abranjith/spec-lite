import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";

/**
 * Recursively copy a directory tree.
 */
function copyDirRecursive(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  onSuccess: async () => {
    // Copy bundled stack snippets to dist/stacks/ so they're available at runtime
    const srcDir = "src/stacks";
    const destDir = "dist/stacks";
    mkdirSync(destDir, { recursive: true });
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }
    console.log(`Copied ${files.length} stack snippets to dist/stacks/`);

    // Copy new agents/, skills/, references/ directories if they exist
    for (const dir of ["agents", "skills", "references"]) {
      const count = copyDirRecursive(dir, join("dist", dir));
      if (count > 0) {
        console.log(`Copied ${count} files to dist/${dir}/`);
      }
    }
  },
});
