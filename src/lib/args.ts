import type { OutputMode } from "./runner";

export type ParsedArgs = {
  help: boolean;
  version: boolean;
  /** `-y` / `--yes` / `--fix` was passed (and not overridden by `--no-fix`). */
  autoFix: boolean;
  /** `--no-fix` was passed. */
  noFix: boolean;
  /** `--strict` was passed: warned checks fail the run. */
  strict: boolean;
  /** `--bail`: stop at the first failed check. */
  bail: boolean;
  /** `--failed`: run the checks that failed, warned or did not run last time. */
  failed: boolean;
  /** `--json`: print only a JSON report. */
  json: boolean;
  /** `--verbose`: stream full output even in AI agent terminals. */
  verbose: boolean;
  /** Whether to print the usage box in AI agent terminals (`-nh` / `--no-hints` turns it off). */
  hints: boolean;
  /** Positional arguments: names of the checks to run (all when empty). */
  names: string[];
  /** Flags greenly does not recognize (typos like `--fxi`). */
  unknown: string[];
};

const KNOWN_FLAGS = new Set([
  "-h",
  "--help",
  "-v",
  "--version",
  "-y",
  "--yes",
  "--fix",
  "--no-fix",
  "--strict",
  "--bail",
  "--failed",
  "--json",
  "--verbose",
  "-nh",
  "--no-hints",
]);

export type RunMode = {
  /** Auto-run every fixer without prompting. */
  autoFix: boolean;
  /** Whether interactive prompts are allowed. */
  interactive: boolean;
  /** Warned checks fail the run (exit 1). */
  strict: boolean;
  /** Stop at the first failed check. */
  bail: boolean;
  output: OutputMode;
};

/** Parse the raw CLI arguments into flags. `--no-fix` wins over `--yes`/`--fix`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const has = (...flags: string[]) => argv.some((a) => flags.includes(a));
  const noFix = has("--no-fix");
  return {
    help: has("-h", "--help"),
    version: has("-v", "--version"),
    noFix,
    autoFix: !noFix && has("-y", "--yes", "--fix"),
    strict: has("--strict"),
    bail: has("--bail"),
    failed: has("--failed"),
    json: has("--json"),
    verbose: has("--verbose"),
    hints: !has("-nh", "--no-hints"),
    names: argv.filter((a) => !a.startsWith("-")),
    unknown: argv.filter((a) => a.startsWith("-") && !KNOWN_FLAGS.has(a)),
  };
}

/**
 * Resolve how the run should behave from parsed flags, TTY state and whether an
 * AI agent runs greenly. Prompts are only allowed on a TTY, when neither
 * `--yes`, `--no-fix` nor `--json` is set. Agents get compact output unless `--verbose`.
 */
export function resolveMode(parsed: ParsedArgs, isTTY: boolean, agent = false): RunMode {
  const output: OutputMode = parsed.json ? "json" : agent && !parsed.verbose ? "compact" : "stream";
  return {
    autoFix: parsed.autoFix,
    interactive: !parsed.noFix && !parsed.autoFix && !parsed.json && isTTY,
    strict: parsed.strict,
    bail: parsed.bail,
    output,
  };
}

export type LogsArgs = {
  help: boolean;
  /** `--failed`: show the logs of failed, warned and not-run checks. */
  failed: boolean;
  /** `--json`: print the saved manifest. */
  json: boolean;
  names: string[];
  unknown: string[];
};

const LOGS_FLAGS = new Set(["-h", "--help", "--failed", "--json"]);

/** Parse the arguments after `greenly logs`. */
export function parseLogsArgs(argv: string[]): LogsArgs {
  const has = (...flags: string[]) => argv.some((a) => flags.includes(a));
  return {
    help: has("-h", "--help"),
    failed: has("--failed"),
    json: has("--json"),
    names: argv.filter((a) => !a.startsWith("-")),
    unknown: argv.filter((a) => a.startsWith("-") && !LOGS_FLAGS.has(a)),
  };
}
