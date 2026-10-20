import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;
const outDir = resolve(root, "dist");

/** Static files copied verbatim next to the bundled script. */
const STATIC_ASSETS = ["module.json", "lang", "templates", "styles"];

function copyFoundryAssets(): Plugin {
  return {
    name: "tidy-renown:copy-foundry-assets",
    buildStart() {
      for (const asset of STATIC_ASSETS) this.addWatchFile(resolve(root, "src", asset));
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      for (const asset of STATIC_ASSETS) {
        const from = resolve(root, "src", asset);
        if (existsSync(from)) cpSync(from, resolve(outDir, asset), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "es2022",
    lib: {
      entry: resolve(root, "src/main.ts"),
      formats: ["es"],
      fileName: () => "scripts/main.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  plugins: [copyFoundryAssets()],
});
