/**
 * Context passed to an `onFail` function when a check fails.
 */
export interface OnFailContext {
  /** The check that failed. */
  check: GreenlyCheck;
  /** The error thrown while running the check's command. */
  error: unknown;
}

/**
 * A function run to fix a failing check. Invoked after the user confirms
 * (or automatically with `--yes`/`--fix`). Throw to signal the fix failed.
 */
export type OnFailFn = (ctx: OnFailContext) => void | Promise<void>;

/**
 * A function run in-process as a check, instead of a shell command. May be
 * async. Throw (or reject) to mark the check as failed; return to pass.
 */
export type CommandFn = () => void | Promise<void>;

/**
 * A single check to run, in order.
 */
export interface GreenlyCheck {
  /** Label shown while running and in the final summary, e.g. "TypeScript". */
  name: string;
  /**
   * The check to run: a shell command string (e.g. `"pnpm tsc --noEmit"`), or
   * a function run in-process instead. A function may be async, and must throw
   * (or reject) to fail the check.
   */
  command: string | CommandFn;
  /**
   * Command string, or a function, run to fix the check when it fails.
   * The user is asked Yes/No first (skipped with `--yes`/`--fix`, or when
   * running non-interactively). A string is executed as a shell command.
   */
  onFail?: string | OnFailFn;
  /**
   * When `true`, a failure warns but does not fail the overall run
   * (no non-zero exit code).
   */
  optional?: boolean;
}

/**
 * Greenly configuration. Author it with {@link defineConfig} in a
 * `greenly.config.{ts,js,mts,mjs,cts,cjs,json}` file.
 */
export interface GreenlyConfig {
  /** Project name shown in the banner. Defaults to the package name / cwd. */
  name?: string;
  /** Ordered list of checks to run. */
  checks: GreenlyCheck[];
}
