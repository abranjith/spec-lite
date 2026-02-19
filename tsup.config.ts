import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

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
  },
});
