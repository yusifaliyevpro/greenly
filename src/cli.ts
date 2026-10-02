#!/usr/bin/env node
import { dirname, relative, resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { agentHints, invocation, isAgentEnv } from "./lib/agent";
import { parseArgs, resolveMode } from "./lib/args";
import { colors } from "./lib/colors";
import { ConfigInvalidError, ConfigNotFoundError, loadGreenlyConfig } from "./lib/config";
import { runInit } from "./lib/init";
import { runChecks } from "./lib/runner";
import { RESERVED_NAMES, checkSlug, reservedChecks, selectChecks } from "./lib/select";
import { detectLockfiles, detectPackageManager, installCommand } from "./lib/utils";
import { checkForUpdate } from "./lib/version";
import type { UpdateInfo } from "./lib/version";

const HELP = `${colors.bold("greenly")} - config-driven project check runner

${colors.bold("Usage")}
  greenly [options] [check...]
  greenly init        Scaffold a greenly.config file interactively

  Checks are named by their lowercase name with spaces as dashes, e.g.
  "greenly oxlint tests" runs only "Oxlint" and "Tests". No names runs all.

${colors.bold("Options")}
  -y, --yes, --fix   Auto-run every onFail fixer without prompting (CI / agents)
      --no-fix       Run all checks, never prompt or fix, just report
      --strict       Warned checks (warnings, failed optional checks) also exit 1
      --no-hints     Don't print the usage box shown in AI agent terminals
  -v, --version      Print version
  -h, --help         Show this help

${colors.bold("Config")}
  Add a greenly.config.{ts,js,mts,mjs,cts,cjs,json} file (found in the current
  folder or the nearest parent, up to the repository root):

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
  if (parsed.unknown.length > 0) {
    console.error(colors.red(`Unknown option${parsed.unknown.length > 1 ? "s" : ""}: ${parsed.unknown.join(" ")}`));
    console.error(`Run ${colors.bold("greenly --help")} for usage.`);
    process.exitCode = 1;
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
    const { config, configFile } = await loadGreenlyConfig();
    const slugs = config.checks.map((c) => checkSlug(c.name)).filter((s) => !RESERVED_NAMES.has(s));
    for (const check of reservedChecks(config.checks)) {
      console.log(
        colors.yellow(
          `⚠ Check "${check.name}" can't be run by name: "greenly ${checkSlug(check.name)}" is a subcommand. Change that check name.`,
        ),
      );
    }
    const { selected, unknown } = selectChecks(config.checks, parsed.names);
    if (unknown.length > 0) {
      console.error(colors.red(`Unknown check${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`));
      console.error(`Available checks: ${slugs.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    // Commands are written relative to the config, so run them from its folder (monorepos).
    const configDir = dirname(configFile);
    if (resolve(configDir) !== resolve(process.cwd())) {
      console.log(colors.dim(`Using ${relative(process.cwd(), configFile)}`));
      process.chdir(configDir);
    }

    const { exitCode } = await runChecks({ ...config, checks: selected }, mode);
    // Set exitCode instead of process.exit() so pending async handles (e.g. an
    // undici socket left open by a fetch in a function check) close cleanly.
    process.exitCode = exitCode;

    const update = updateCheck ? await updateCheck : null;
    if (update) printUpdateNotice(update);

    if (parsed.hints && isAgentEnv(process.env)) {
      console.log(agentHints(invocation(process.env, detectLockfiles(process.cwd())), slugs) + "\n");
    }
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
