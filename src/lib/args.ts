export type ParsedArgs = {
  help: boolean;
  version: boolean;
  /** `-y` / `--yes` / `--fix` was passed (and not overridden by `--no-fix`). */
  autoFix: boolean;
  /** `--no-fix` was passed. */
  noFix: boolean;
  /** `--strict` was passed: warned checks fail the run. */
  strict: boolean;
  /** Whether to print the usage box in AI agent terminals (`--no-hints` turns it off). */
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
  "--no-hints",
]);

export type RunMode = {
  /** Auto-run every fixer without prompting. */
  autoFix: boolean;
  /** Whether interactive prompts are allowed. */
  interactive: boolean;
  /** Warned checks fail the run (exit 1). */
  strict: boolean;
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
    hints: !has("--no-hints"),
    names: argv.filter((a) => !a.startsWith("-")),
    unknown: argv.filter((a) => a.startsWith("-") && !KNOWN_FLAGS.has(a)),
  };
}

/**
 * Resolve how the run should behave from parsed flags and TTY state.
 * Prompts are only allowed on a TTY, when neither `--yes` nor `--no-fix` is set.
 */
export function resolveMode(parsed: ParsedArgs, isTTY: boolean): RunMode {
  return {
    autoFix: parsed.autoFix,
    interactive: !parsed.noFix && !parsed.autoFix && isTTY,
    strict: parsed.strict,
  };
}
