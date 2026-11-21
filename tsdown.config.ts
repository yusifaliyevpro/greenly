import { defineConfig } from "tsdown";

export default defineConfig([
  // Library entry: defineConfig + types. ESM only: Node >=22.12 can require() it.
  {
    entry: ["src/index.ts"],
    format: "esm",
    dts: true,
    clean: true,
    platform: "node",
    outDir: "dist",
  },
  // CLI bin: single self-contained ESM file named cli.js, runtime deps bundled in.
  {
    entry: ["src/cli.ts"],
    format: "esm",
    platform: "node",
    target: "node18",
    outDir: "dist",
    clean: false,
    dts: false,
    deps: { onlyBundle: false },
    outputOptions: {
      entryFileNames: "cli.js",
      comments: false,
    },
  },
]);
