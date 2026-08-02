#!/usr/bin/env node
import pkg from "../package.json" with { type: "json" };
import { parseArgs, resolveMode } from "./lib/args";
import { colors } from "./lib/colors";
import { ConfigInvalidError, ConfigNotFoundError, loadGreenlyConfig } from "./lib/config";
import { runInit } from "./lib/init";
import { runChecks } from "./lib/runner";
import { detectLockfiles, detectPackageManager, installCommand } from "./lib/utils";
import { checkForUpdate } from "./lib/version";
import type { UpdateInfo } from "./lib/version";

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

/** Print an "update available" notice with the command to update. */
function printUpdateNotice(info: UpdateInfo): void {
  const pm = detectPackageManager(process.env.npm_config_user_agent, detectLockfiles(process.cwd()));
  console.log(colors.yellow(`Update available: greenly ${colors.dim(info.current)} -> ${colors.bold(info.latest)}`));
  console.log(colors.bold(installCommand(pm)) + "\n");
}

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

  const isTTY = process.stdout.isTTY ?? false;
  const mode = resolveMode(parsed, isTTY);

  // Aside: check npm for a newer greenly while the checks run. Non-blocking,
  // never throws, skipped on non-TTY (CI/agents). Reported at the end. Starting
  // it here (rather than after the checks) overlaps the network round-trip with
  // the checks so the result is ready by the time they finish — the notice adds
  // no delay before exit. fetchLatestVersion's timeout is starvation-aware, so
  // the config load / checks blocking the loop don't abort this healthy fetch.
  const updateCheck = isTTY ? checkForUpdate(pkg.name, pkg.version) : null;

  try {
    const { config } = await loadGreenlyConfig();
    const { exitCode } = await runChecks(config, mode);
    // Set exitCode instead of process.exit() so pending async handles (e.g. an
    // undici socket left open by a fetch in a function check) close cleanly.
    process.exitCode = exitCode;

    const update = updateCheck ? await updateCheck : null;
    if (update) printUpdateNotice(update);
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
