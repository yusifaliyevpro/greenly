import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { CONFIG_EXTENSIONS } from "./constants";
import type { GreenlyConfig } from "./types";

/** Base name of the config file, without extension. */
const CONFIG_BASENAME = "greenly.config";

/** Thrown when no `greenly.config.*` file can be found. */
export class ConfigNotFoundError extends Error {
  constructor(public cwd: string) {
    super(
      `No ${CONFIG_BASENAME} file found in ${cwd}.\n` +
        `Create one, e.g. ${CONFIG_BASENAME}.ts:\n\n` +
        `  import { defineConfig } from "greenly";\n\n` +
        `  export default defineConfig({\n` +
        `    name: "MyProject",\n` +
        `    checks: [{ name: "TypeScript", command: "pnpm tsc --noEmit" }],\n` +
        `  });`,
    );
    this.name = "ConfigNotFoundError";
  }
}

/** Thrown when a config file is found but its contents are invalid. */
export class ConfigInvalidError extends Error {
  constructor(
    public configFile: string,
    detail: string,
  ) {
    super(`Invalid config in ${configFile}: ${detail}`);
    this.name = "ConfigInvalidError";
  }
}

/**
 * Find the first `greenly.config.*` file in `cwd`, trying each supported
 * extension in order. Returns the absolute path, or `undefined` if none exists.
 */
export function findConfigFile(cwd: string = process.cwd()): string | undefined {
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = resolve(cwd, `${CONFIG_BASENAME}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Load and validate the Greenly config from `cwd`.
 *
 * @throws {ConfigNotFoundError} when no config file exists.
 * @throws {ConfigInvalidError} when the config is malformed.
 */
export async function loadGreenlyConfig(
  cwd: string = process.cwd(),
): Promise<{ config: GreenlyConfig; configFile: string }> {
  const configFile = findConfigFile(cwd);
  if (!configFile) throw new ConfigNotFoundError(cwd);

  // jiti runs .ts/.mts/.cts (and .js/.mjs/.cjs/.json) at runtime and resolves the
  // config's own `import "greenly"` through the installed package.
  const jiti = createJiti(pathToFileURL(resolve(cwd, "greenly.config")).href);
  const config = await jiti.import<GreenlyConfig>(configFile, { default: true });

  if (!config || typeof config !== "object") {
    throw new ConfigInvalidError(configFile, "config must export an object");
  }
  if (!Array.isArray(config.checks) || config.checks.length === 0) {
    throw new ConfigInvalidError(configFile, `"checks" must be a non-empty array`);
  }
  for (const [i, check] of config.checks.entries()) {
    const validCommand = typeof check?.command === "string" || typeof check?.command === "function";
    if (!check || typeof check.name !== "string" || !validCommand) {
      throw new ConfigInvalidError(
        configFile,
        `checks[${i}] must have a string "name" and a string or function "command"`,
      );
    }
  }

  return { config, configFile };
}
