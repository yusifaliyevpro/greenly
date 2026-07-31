#!/usr/bin/env node
import pkg from "../package.json" with { type: "json" };
import { parseArgs, resolveMode } from "./lib/args";
import { colors } from "./lib/colors";
import { ConfigInvalidError, ConfigNotFoundError, loadGreenlyConfig } from "./lib/config";
import { runInit } from "./lib/init";
import { runChecks } from "./lib/runner";

const HELP = `${colors.bold("greenly")} - config-driven project check runner

${colors.bold("Usage")}
  greenly [options]
  greenly init        Scaffold a greenly.config file interactively

${colors.bold("Options")}
  -y, --yes, --fix   Auto-run every onFail fixer without prompting (CI / agents)
      --no-fix       Run all checks, never prompt or fix, just report
  -v, --version      Print version
  -h, --help         Show this help

${colors.bold("Config")}
  Add a greenly.config.{ts,js,mts,mjs,cts,cjs,json} file:

    import { defineConfig } from "greenly";

    export default defineConfig({
      name: "MyProject",
      checks: [
        { name: "TypeScript", command: "pnpm tsc --noEmit" },
        { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
        { name: "Lint", command: "pnpm oxlint" },
      ],
    });
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "init") {
    await runInit();
    return;
  }

  const parsed = parseArgs(argv);

  if (parsed.help) {
    console.log(HELP);
    return;
  }
  if (parsed.version) {
    console.log(pkg.version);
    return;
  }

  const mode = resolveMode(parsed, process.stdout.isTTY ?? false);

  try {
    const { config } = await loadGreenlyConfig();
    const { exitCode } = await runChecks(config, mode);
    // Set exitCode instead of process.exit() so pending async handles (e.g. an
    // undici socket left open by a fetch in a function check) close cleanly.
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof ConfigNotFoundError || error instanceof ConfigInvalidError) {
      console.error(colors.red(error.message));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
