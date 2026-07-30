import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    alias: {
      greenly: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
});
