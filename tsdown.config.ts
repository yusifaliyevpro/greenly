import { defineConfig } from "tsdown";

export default defineConfig([
  // Library entry: defineConfig + types (dual ESM/CJS with declarations).
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    platform: "node",
    outDir: "dist",
  },
  // CLI bin: single ESM file named cli.js, runtime deps left external.
  {
    entry: ["src/cli.ts"],
    format: "esm",
    platform: "node",
    outDir: "dist",
    clean: false,
    dts: false,
    outputOptions: {
      entryFileNames: "cli.js",
      comments: false,
    },
    deps: {
      neverBundle: ["@clack/prompts", "c12"],
    },
  },
]);
