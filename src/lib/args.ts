export type ParsedArgs = {
  help: boolean;
  version: boolean;
  /** `-y` / `--yes` / `--fix` was passed (and not overridden by `--no-fix`). */
  autoFix: boolean;
  /** `--no-fix` was passed. */
  noFix: boolean;
};

export type RunMode = {
  /** Auto-run every fixer without prompting. */
  autoFix: boolean;
  /** Whether interactive prompts are allowed. */
  interactive: boolean;
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
  };
}
