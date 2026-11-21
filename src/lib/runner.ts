import { execSync, spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { colors, colorsEnabled } from "./colors";
import { countLines, lineCount } from "./logs";
import type { LogStore } from "./logs";
import { checkSlug } from "./select";
import { TailBuffer } from "./tail";
import type { GreenlyCheck, GreenlyConfig } from "./types";
import { hasWarnings } from "./warnings";

/**
 * `stream`: live output (normal terminals, CI). `compact`: one line per passing
 * check and the tail of failing output (AI agents). `json`: only a JSON report.
 */
export type OutputMode = "stream" | "compact" | "json";

export type RunOptions = {
  /** Auto-run every `onFail` fixer without prompting (e.g. `--yes`/`--fix`). */
  autoFix?: boolean;
  /** Whether interactive prompts are allowed. When `false`, never prompt or fix. */
  interactive?: boolean;
  /** Warned checks fail the run (exit 1), e.g. `--strict`. */
  strict?: boolean;
  /** Stop at the first failed check (`--bail`); the rest are reported as not run. */
  bail?: boolean;
  output?: OutputMode;
  /** Where each check's output is saved. Unset: nothing is saved. */
  logs?: LogStore;
};

/** `warned`: not clean, but not blocking (see `WarnReason`). `not-run`: skipped by `bail`. */
type CheckStatus = "passed" | "fixed" | "failed" | "warned" | "not-run";

/** `warnings`: the command passed but printed warnings. `optional`: an optional check failed. */
type WarnReason = "warnings" | "optional";

type CheckResult = {
  name: string;
  status: CheckStatus;
  reason?: WarnReason;
  durationMs?: number;
  /** Output lines saved for the check. */
  lines?: number;
};

export type RunResult = {
  results: CheckResult[];
  /** Number of non-optional checks that ended up failing. */
  failed: number;
  /** Number of warned checks (warnings, or a failed optional check). */
  warned: number;
  /** Number of checks skipped by `bail`. */
  notRun: number;
  /** Exit code: 1 when any non-optional check failed (or, with `strict`, any check warned), else 0. */
  exitCode: number;
};

/** Minimum banner width, and the padding kept on each side of the centered name. */
const MIN_WIDTH = 60;
const SIDE_PADDING = 3;
/** Output lines shown for a failing or warned check in compact mode. */
export const TAIL_LINES = 40;

/** Rule width: the default, but widened so a long name always fits with padding. */
function bannerWidth(name: string): number {
  const base = Math.min(process.stdout.columns ?? MIN_WIDTH, MIN_WIDTH);
  return Math.max(base, name.length + SIDE_PADDING * 2);
}

/** Center `text` within `width`, padding both sides with spaces. */
function center(text: string, width: number): string {
  const total = Math.max(0, width - text.length);
  const left = Math.floor(total / 2);
  return " ".repeat(left) + text + " ".repeat(total - left);
}

/** Short duration, e.g. "0.8s" or "2m 5s". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

type CommandResult = {
  ok: boolean;
  /** Captured stdout, scanned for warnings. */
  stdout: string;
  /** Captured stderr (pnpm's own `$ script` echo and error output live here). */
  stderr: string;
  /** stdout and stderr in arrival order, without ANSI codes: what gets saved. */
  log: string;
  /** Whether `log` lost earlier output to the size cap. */
  truncated: boolean;
  /** The value thrown by the command, forwarded to an `onFail` fixer. Unset on success. */
  error?: unknown;
};

/**
 * Run a check's command. A shell string captures stdout (streamed live when
 * `live`) and stderr (buffered, so the package manager's `$ <script>` echo
 * stays hidden). A function runs in-process and fails only if it throws.
 */
async function runCommand(command: GreenlyCheck["command"], live: boolean): Promise<CommandResult> {
  if (typeof command === "function") {
    try {
      await command();
      return { ok: true, stdout: "", stderr: "", log: "", truncated: false };
    } catch (error) {
      const message = formatThrown(error);
      return { ok: false, stdout: "", stderr: colors.red(message), log: `${message}\n`, truncated: false, error };
    }
  }

  return new Promise((resolve) => {
    // Piping stdout would drop the child's colors, so keep them when we're on a TTY.
    const env = { ...process.env };
    if (colorsEnabled && env.FORCE_COLOR === undefined) env.FORCE_COLOR = "1";

    const child = spawn(command, { shell: true, stdio: ["inherit", "pipe", "pipe"], env });
    const stdout = new TailBuffer();
    const stderr = new TailBuffer();
    const combined = new TailBuffer();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (live) process.stdout.write(chunk);
      stdout.push(chunk);
      combined.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      combined.push(chunk);
    });

    child.on("error", (error) =>
      resolve({ ok: false, stdout: "", stderr: error.message, log: `${error.message}\n`, truncated: false, error }),
    );
    child.on("close", (code, signal) => {
      const out = stdout.toString();
      const err = (stderr.truncated ? "[earlier stderr truncated]\n" : "") + stderr.toString();
      const log = stripVTControlCharacters(combined.toString());
      if (code === 0) {
        resolve({ ok: true, stdout: out, stderr: err, log, truncated: combined.truncated });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      const error = Object.assign(new Error(`Command failed with ${reason}: ${command}`), {
        status: code,
        signal,
        stdout: out,
        stderr: err,
      });
      resolve({ ok: false, stdout: out, stderr: err, log, truncated: combined.truncated, error });
    });
  });
}

/** Readable string for an unknown value, JSON-encoding plain objects. */
function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

/**
 * Format a value thrown by a function command as its message (plus cause),
 * without the stack trace. Rejections and non-Error throws are handled too.
 */
function formatThrown(error: unknown): string {
  if (error instanceof Error) {
    let message = error.message || error.name;
    if (error.cause !== undefined) message += `\nCause: ${describeUnknown(error.cause)}`;
    return message;
  }
  return describeUnknown(error);
}

/** How the check's command is shown under its name. */
function commandLine(command: GreenlyCheck["command"]): string {
  if (typeof command === "string") return `$ ${command}`;
  return command.name ? `→ ${command.name}()` : "→ (function)";
}

/**
 * Run a check's `onFail` fixer (command string or function). With `capture`,
 * a string fixer's output is returned instead of shown in the terminal.
 */
async function runFix(check: GreenlyCheck, error: unknown, capture: boolean): Promise<{ ok: boolean; output: string }> {
  try {
    if (typeof check.onFail === "string") {
      if (!capture) {
        execSync(check.onFail, { stdio: "inherit" });
        return { ok: true, output: "(output shown in the terminal)\n" };
      }
      const out = execSync(check.onFail, { stdio: ["inherit", "pipe", "pipe"] });
      return { ok: true, output: stripVTControlCharacters(String(out ?? "")) };
    }
    if (typeof check.onFail === "function") await check.onFail({ check, error });
    return { ok: true, output: "" };
  } catch (fixError) {
    const streams =
      typeof fixError === "object" && fixError !== null
        ? [Reflect.get(fixError, "stdout"), Reflect.get(fixError, "stderr")]
        : [];
    const output =
      streams.filter((s) => typeof s === "string" || Buffer.isBuffer(s)).join("") || `${formatThrown(fixError)}\n`;
    return { ok: false, output: stripVTControlCharacters(output) };
  }
}

/** Extra label in the "Warned checks" list; plain warnings need none. */
const REASON_LABEL: Record<WarnReason, string> = { warnings: "", optional: " (optional, failed)" };

/** Result for a check that ended up failing: warned when optional, else failed. */
function softFail(check: GreenlyCheck): CheckResult {
  return check.optional
    ? { name: check.name, status: "warned", reason: "optional" }
    : { name: check.name, status: "failed" };
}

/** Label describing the fixer, for prompts and logs. */
function fixLabel(check: GreenlyCheck): string {
  return typeof check.onFail === "string" ? `"${check.onFail}"` : "the fix function";
}

/** The fixer's command text, for the "$ ..." line shown before it runs. */
function fixCommand(check: GreenlyCheck): string {
  return typeof check.onFail === "string" ? check.onFail : "fix function";
}

/** The last `TAIL_LINES` lines of `output`, noting how many earlier lines are in the log file. */
export function outputTail(output: string, logPath?: string): string {
  const lines = output.replace(/\s+$/, "").split(/\r?\n/);
  if (lines.length === 1 && lines[0] === "") return "";
  if (lines.length <= TAIL_LINES) return lines.join("\n");
  const hidden = lines.length - TAIL_LINES;
  const where = logPath ? `in ${logPath}` : "not shown";
  return [colors.dim(`[${hidden} earlier lines ${where}]`), ...lines.slice(-TAIL_LINES)].join("\n");
}

/**
 * Run all checks sequentially. Output depends on `output` (see `OutputMode`),
 * fixable checks prompt (via clack) before running, and each check's output is
 * saved to `logs` when given.
 */
export async function runChecks(config: GreenlyConfig, options: RunOptions = {}): Promise<RunResult> {
  const { autoFix = false, interactive = true, strict = false, bail = false, output = "stream", logs } = options;
  const stream = output === "stream";
  const compact = output === "compact";
  const print = (text = "") => {
    if (output !== "json") console.log(text);
  };

  const name = config.name ?? "greenly";
  const width = bannerWidth(name);
  const rule = (char: string) => char.repeat(width);
  const separator = () => {
    if (stream) console.log("\n" + colors.dim(rule("─")) + "\n");
  };
  const logPath = (check: GreenlyCheck) => (logs ? logs.display(logs.pathFor(checkSlug(check.name))) : undefined);
  const showTail = (check: GreenlyCheck, text: string) => {
    const tail = outputTail(text, logPath(check));
    if (compact && tail) console.log(tail);
  };

  if (stream) {
    console.log();
    console.log(colors.cyan(colors.bold(rule("═"))));
    console.log(colors.cyan(colors.bold(center(name, width))));
    console.log(colors.cyan(colors.bold(rule("═"))));
    console.log();
  } else if (compact) {
    console.log(colors.cyan(colors.bold(`── ${name} ──`)));
  }

  const results: CheckResult[] = [];
  const finish = (check: GreenlyCheck, result: CheckResult, durationMs: number, log: string, truncated: boolean) => {
    results.push({ ...result, durationMs: Math.round(durationMs), lines: countLines(log) });
    logs?.record(check, { status: result.status, reason: result.reason, durationMs, output: log, truncated });
  };

  for (const [index, check] of config.checks.entries()) {
    if (stream) {
      console.log(colors.bold(colors.yellow(`▶ ${check.name}`)));
      console.log(`  ${colors.cyan(commandLine(check.command))}\n`);
    }

    const started = performance.now();
    const { ok, stdout, stderr, log, truncated, error } = await runCommand(check.command, stream);
    const durationMs = performance.now() - started;
    const took = colors.dim(`(${formatDuration(durationMs)})`);

    // Only stdout: linters report there, while stderr carries Node / package-manager warnings.
    if (ok && !check.ignoreWarnings && hasWarnings(stdout)) {
      if (stream) {
        console.log(`\n${colors.yellow(`⚠ WARNINGS: ${check.name}`)} ${took}`);
        console.log(colors.yellow(`  Exited successfully but reported warnings.`));
      } else if (compact) {
        console.log(`${colors.yellow(`⚠ ${check.name}`)} ${took}`);
        showTail(check, log);
      }
      finish(check, { name: check.name, status: "warned", reason: "warnings" }, durationMs, log, truncated);
      separator();
      continue;
    }

    if (ok) {
      if (stream) console.log(`\n${colors.green(`✔ PASSED: ${check.name}`)} ${took}`);
      else if (compact) console.log(`${colors.green(`✔ ${check.name}`)} ${took}`);
      finish(check, { name: check.name, status: "passed" }, durationMs, log, truncated);
      separator();
      continue;
    }

    if (stream) {
      if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
      console.log(`\n${colors.red(`✖ FAILED: ${check.name}`)} ${took}`);
    } else if (compact) {
      console.log(`${colors.red(`✖ ${check.name}`)} ${took}`);
      showTail(check, log);
    }

    let result: CheckResult;
    let saved = log;

    // Decide whether to run the fixer.
    let shouldFix = check.onFail !== undefined && autoFix;
    if (check.onFail !== undefined && !autoFix && interactive) {
      const answer = await confirm({
        message: `Run ${fixLabel(check)} to fix ${colors.bold(check.name)}?`,
        initialValue: true,
      });
      if (isCancel(answer)) {
        cancel("Aborted.");
        finish(check, softFail(check), durationMs, log, truncated);
        const failedSoFar = results.filter((r) => r.status === "failed").length;
        const warnedSoFar = results.filter((r) => r.status === "warned").length;
        return { results, failed: failedSoFar, warned: warnedSoFar, notRun: 0, exitCode: 1 };
      }
      shouldFix = answer;
    }

    if (check.onFail === undefined) {
      if (check.optional) print(colors.yellow(`  ${check.name} is optional, continuing.`));
      result = softFail(check);
    } else if (!shouldFix) {
      if (!interactive && !autoFix) print(colors.dim(`  Fixer available, re-run with --yes to auto-fix.`));
      else print(colors.yellow(`  Skipped fix.`));
      result = softFail(check);
    } else {
      if (stream) console.log(`\n  ${colors.cyan(`$ ${fixCommand(check)}`)}\n`);
      else if (compact) console.log(`  ${colors.cyan(`$ ${fixCommand(check)}`)}`);
      const fix = await runFix(check, error, !stream);
      saved = `${log}\n--- fix: ${fixCommand(check)} (${fix.ok ? "succeeded" : "failed"}) ---\n${fix.output}`;
      if (fix.ok) {
        if (stream) console.log(`\n${colors.green(`✔ Auto-fixed: ${check.name}`)}\n`);
        else if (compact) console.log(colors.green(`  ✔ Auto-fixed: ${check.name}`));
        result = { name: check.name, status: "fixed" };
      } else {
        if (stream) console.log(`\n${colors.red(`  Auto-fix failed for ${check.name}, please fix manually.`)}\n`);
        else if (compact) {
          console.log(colors.red(`  Auto-fix failed for ${check.name}:`));
          const tail = outputTail(fix.output);
          if (tail) console.log(tail);
        }
        result = softFail(check);
      }
    }

    finish(check, result, durationMs, saved, truncated);
    separator();

    if (bail && result.status === "failed") {
      const skipped = config.checks.slice(index + 1);
      for (const rest of skipped) results.push({ name: rest.name, status: "not-run" });
      if (skipped.length > 0) print(colors.yellow(`Bailing after ${check.name} failed (--bail).\n`));
      break;
    }
  }

  const passed = results.filter((r) => r.status === "passed" || r.status === "fixed").length;
  const warnedResults = results.filter((r) => r.status === "warned");
  const warned = warnedResults.length;
  const failedResults = results.filter((r) => r.status === "failed");
  const failed = failedResults.length;
  const notRunResults = results.filter((r) => r.status === "not-run");
  const notRun = notRunResults.length;
  const exitCode = failed > 0 || (strict && warned > 0) ? 1 : 0;

  if (output === "json") {
    const report = {
      name,
      exitCode,
      passed,
      warned,
      failed,
      notRun,
      checks: results.map((r) => {
        const check = config.checks.find((c) => c.name === r.name);
        return {
          name: r.name,
          slug: checkSlug(r.name),
          status: r.status,
          ...(r.reason ? { reason: r.reason } : {}),
          ...(r.durationMs === undefined ? {} : { durationMs: r.durationMs, lines: r.lines }),
          ...(check && logs && r.status !== "not-run" ? { log: logPath(check) } : {}),
        };
      }),
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return { results, failed, warned, notRun, exitCode };
  }

  // In compact mode, point each problem check at its saved log so it can be read without a re-run.
  const where = (r: CheckResult) => {
    const check = config.checks.find((c) => c.name === r.name);
    const path = compact && check ? logPath(check) : undefined;
    return path ? ` ${colors.dim(`→ ${path} (${lineCount(r.lines ?? 0)})`)}` : "";
  };

  if (stream) console.log(colors.cyan(colors.bold(rule("═"))));
  else console.log();
  const summary =
    colors.green(`${passed} passed`) +
    (warned > 0 ? colors.dim(", ") + colors.yellow(`${warned} warned`) : "") +
    colors.dim(", ") +
    (failed > 0 ? colors.red(`${failed} failed`) : colors.dim("0 failed")) +
    (notRun > 0 ? colors.dim(", ") + colors.yellow(`${notRun} not run`) : "");
  console.log(colors.bold(`${stream ? "   " : ""}Results: ${summary}`));

  if (warned > 0) {
    console.log(`\n${colors.yellow(colors.bold("Warned checks:"))}`);
    for (const r of warnedResults) {
      console.log(colors.yellow(`  • ${r.name}${REASON_LABEL[r.reason ?? "optional"]}`) + where(r));
    }
  }

  if (failed > 0) {
    console.log(`\n${colors.red(colors.bold("Failed checks:"))}`);
    for (const r of failedResults) console.log(colors.red(`  • ${r.name}`) + where(r));
  }

  if (notRun > 0) {
    console.log(`\n${colors.yellow(colors.bold("Not run (--bail):"))}`);
    for (const r of notRunResults) console.log(colors.yellow(`  • ${r.name}`));
  }

  if (failed > 0) {
    console.log(`\n${colors.red(colors.bold("⚠  Fix the issues above before continuing."))}\n`);
  } else if (warned > 0 && strict) {
    console.log(`\n${colors.red(colors.bold("✖  Strict mode: warned checks fail the run."))}\n`);
  } else if (warned > 0) {
    console.log(`\n${colors.yellow(colors.bold("⚠  No failures, but some checks warned."))}\n`);
  } else {
    console.log(`\n${colors.green(colors.bold("✔  All checks passed!"))}\n`);
  }

  return { results, failed, warned, notRun, exitCode };
}
