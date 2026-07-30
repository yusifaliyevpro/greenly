import type { GreenlyConfig } from "./types";

/**
 * Define a Greenly config with full type-checking and editor autocomplete.
 *
 * @example
 * ```ts
 * // greenly.config.ts
 * import { defineConfig } from "greenly";
 *
 * export default defineConfig({
 *   name: "MyProject",
 *   checks: [
 *     { name: "TypeScript", command: "pnpm tsc --noEmit" },
 *     { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
 *     { name: "Lint", command: "pnpm oxlint" },
 *   ],
 * });
 * ```
 */
export function defineConfig(config: GreenlyConfig): GreenlyConfig {
  return config;
}
