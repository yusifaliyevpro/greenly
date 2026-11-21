#!/usr/bin/env node
import { dirname, join, relative, resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { agentHints, invocation, isAgentEnv } from "./lib/agent";
import { parseArgs, parseLogsArgs, resolveMode } from "./lib/args";
import { colors } from "./lib/colors";
import { ConfigInvalidError, ConfigNotFoundError, loadGreenlyConfig } from "./lib/config";
import { runInit } from "./lib/init";
import { acquireLock } from "./lib/lock";
import { CACHE_DIR, LogStore, needsRerun, readManifest } from "./lib/logs";
import { runChecks } from "./lib/runner";
import { RESERVED_NAMES, checkSlug, reservedChecks, selectChecks } from "./lib/select";
import { showLogs } from "./lib/show-logs";
import { detectLockfiles, detectPackageManager, installCommand } from "./lib/utils";
import { checkForUpdate } from "./lib/version";
import type { UpdateInfo } from "./lib/version";

const HELP = `${colors.bold("greenly")} - config-driven project check runner

${colors.bold("Usage")}
  greenly [options] [check...]
  greenly init        Scaffold a greenly.config file interactively
  greenly logs        Show the saved output of the last run (see "greenly logs --help")

  Checks are named by their lowercase name with spaces as dashes, e.g.
  "greenly oxlint tests" runs only "Oxlint" and "Tests". No names runs all.

${colors.bold("Options")}
  -y, --yes, --fix   Auto-run every onFail fixer without prompting (CI / agents)
      --no-fix       Run all checks, never prompt or fix, just report
      --strict       Warned checks (warnings, failed optional checks) also exit 1
      --failed       Run only the checks that failed, warned or did not run last time
      --bail         Stop at the first failed check
      --json         Print only a JSON report (no prompts, no live output)
      --verbose      Stream full output in AI agent terminals too
  -nh, --no-hints    Don't print the usage box shown in AI agent terminals
  -v, --version      Print version
  -h, --help         Show this help

  The last output of each check is saved in node_modules/.cache/greenly.
  Only one greenly per project runs checks at a time, others wait for it.

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

const LOGS_HELP = `${colors.bold("greenly logs")} - show the saved output of the last run, without re-running

${colors.bold("Usage")}
  greenly logs              One line per check: status, duration, lines, log file
  greenly logs <check...>   The saved output of the named checks
  greenly logs --failed     The saved output of failed, warned and not-run checks

${colors.bold("Options")}
      --json        Print the saved manifest (last-run.json)
  -h, --help         Show this help
`;

/** Print an "update available" notice with the command to update. */
function printUpdateNotice(info: UpdateInfo): void {
  const pm = detectPackageManager(process.env.npm_config_user_agent, detectLockfiles(process.cwd()));
  console.log(colors.yellow(`Update available: greenly ${colors.dim(info.current)} -> ${colors.bold(info.latest)}`));
  console.log(colors.bold(installCommand(pm)) + "\n");
}

/** Print unknown options and the help command. */
function reportUnknown(unknown: string[], helpCommand: string): void {
  console.error(colors.red(`Unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.join(" ")}`));
  console.error(`Run ${colors.bold(helpCommand)} for usage.`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "init") {
    await runInit();
    return;
  }

  if (argv[0] === "logs") {
    const args = parseLogsArgs(argv.slice(1));
    if (args.help) console.log(LOGS_HELP);
    else if (args.unknown.length > 0) reportUnknown(args.unknown, "greenly logs --help");
    else process.exitCode = showLogs(args);
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
    reportUnknown(parsed.unknown, "greenly --help");
    return;
  }

  const isTTY = process.stdout.isTTY ?? false;
  const agent = isAgentEnv(process.env);
  const mode = resolveMode(parsed, isTTY, agent);
  const json = mode.output === "json";
  const startCwd = process.cwd();

  // Aside: check npm for a newer greenly while the checks run. Non-blocking,
  // never throws, skipped on non-TTY (CI/agents). Reported at the end. Starting
  // it here (rather than after the checks) overlaps the network round-trip with
  // the checks so the result is ready by the time they finish — the notice adds
  // no delay before exit. fetchLatestVersion's timeout is starvation-aware, so
  // the config load / checks blocking the loop don't abort this healthy fetch.
  const updateCheck = isTTY && !json ? checkForUpdate(pkg.name, pkg.version) : null;

  try {
    const { config, configFile } = await loadGreenlyConfig();
    const slugs = config.checks.map((c) => checkSlug(c.name)).filter((s) => !RESERVED_NAMES.has(s));
    for (const check of reservedChecks(config.checks)) {
      console.error(
        colors.yellow(
          `⚠ Check "${check.name}" can't be run by name: "greenly ${checkSlug(check.name)}" is a subcommand. Change that check name.`,
        ),
      );
    }

    const configDir = dirname(configFile);
    const cacheDir = join(configDir, CACHE_DIR);

    const names = [...parsed.names];
    if (parsed.failed) {
      const manifest = readManifest(cacheDir);
      if (!manifest) {
        console.error(colors.red("--failed: no saved run yet. Run greenly once without --failed first."));
        process.exitCode = 1;
        return;
      }
      // Checks renamed or removed since the last run are dropped.
      const current = new Set(config.checks.map((c) => checkSlug(c.name)));
      names.push(...needsRerun(manifest).filter((slug) => current.has(slug)));
      if (names.length === 0) {
        if (json) console.log(JSON.stringify({ name: config.name, exitCode: 0, checks: [] }, null, 2));
        else console.log(colors.green("No failed, warned or not-run checks in the last run."));
        return;
      }
    }

    const { selected, unknown } = selectChecks(config.checks, names);
    if (unknown.length > 0) {
      console.error(colors.red(`Unknown check${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`));
      console.error(`Available checks: ${slugs.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    // Commands are written relative to the config, so run them from its folder (monorepos).
    if (resolve(configDir) !== resolve(process.cwd())) {
      if (!json) console.log(colors.dim(`Using ${relative(process.cwd(), configFile)}`));
      process.chdir(configDir);
    }

    // Two runs at once (two agents, or a user and an agent) can exhaust RAM, so wait our turn.
    const release = await acquireLock(cacheDir, (pid) => {
      console.error(
        colors.yellow(`Another greenly run (pid ${pid}) is running checks here, waiting for it to finish...`),
      );
    });
    const logs = new LogStore(cacheDir, startCwd);
    logs.begin(config.checks, selected, names.length === 0);

    const { exitCode } = await runChecks({ ...config, checks: selected }, { ...mode, logs });
    release();
    // Set exitCode instead of process.exit() so pending async handles (e.g. an
    // undici socket left open by a fetch in a function check) close cleanly.
    process.exitCode = exitCode;

    const update = updateCheck ? await updateCheck : null;
    if (update) printUpdateNotice(update);

    if (parsed.hints && agent && !json) {
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
