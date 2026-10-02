import { execSync, spawn } from "node:child_process";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { colors, colorsEnabled } from "./colors";
import type { GreenlyCheck, GreenlyConfig } from "./types";
import { hasWarnings } from "./warnings";

export type RunOptions = {
  /** Auto-run every `onFail` fixer without prompting (e.g. `--yes`/`--fix`). */
  autoFix?: boolean;
  /** Whether interactive prompts are allowed. When `false`, never prompt or fix. */
  interactive?: boolean;
};

/** `warned`: an optional check failed. `warnings`: the command passed but printed warnings. */
type CheckStatus = "passed" | "fixed" | "failed" | "warned" | "warnings";

type CheckResult = {
  name: string;
  status: CheckStatus;
};

export type RunResult = {
  results: CheckResult[];
  /** Number of non-optional checks that ended up failing. */
  failed: number;
  /** Number of checks that passed but printed warnings. */
  warnings: number;
  /** Exit code: 1 when any non-optional check failed, else 0. */
  exitCode: number;
};

/** Minimum banner width, and the padding kept on each side of the centered name. */
const MIN_WIDTH = 60;
const SIDE_PADDING = 3;

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

type CommandResult = {
  ok: boolean;
  /** Captured stdout (also streamed live), scanned for warnings. */
  stdout: string;
  /** Captured stderr (pnpm's own `$ script` echo and error output live here). */
  stderr: string;
  /** The value thrown by the command, forwarded to an `onFail` fixer. Unset on success. */
  error?: unknown;
};

/**
 * Run a check's command. A shell string streams stdout live (also capturing it
 * for warning detection) with stderr buffered, so the package manager's own
 * `$ <script>` echo stays hidden. A function runs in-process and fails only if it throws.
 */
async function runCommand(command: GreenlyCheck["command"]): Promise<CommandResult> {
  if (typeof command === "function") {
    try {
      await command();
      return { ok: true, stdout: "", stderr: "" };
    } catch (error) {
      return { ok: false, stdout: "", stderr: colors.red(formatThrown(error)), error };
    }
  }

  return new Promise((resolve) => {
    // Piping stdout would drop the child's colors, so keep them when we're on a TTY.
    const env = { ...process.env };
    if (colorsEnabled && env.FORCE_COLOR === undefined) env.FORCE_COLOR = "1";

    const child = spawn(command, { shell: true, stdio: ["inherit", "pipe", "pipe"], env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => resolve({ ok: false, stdout: "", stderr: error.message, error }));
    child.on("close", (code, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ ok: true, stdout: out, stderr: err });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      const error = Object.assign(new Error(`Command failed with ${reason}: ${command}`), {
        status: code,
        signal,
        stdout: out,
        stderr: err,
      });
      resolve({ ok: false, stdout: out, stderr: err, error });
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

/** Run a check's `onFail` fixer (command string or function). Returns true on success. */
async function runFix(check: GreenlyCheck, error: unknown): Promise<boolean> {
  try {
    if (typeof check.onFail === "string") {
      execSync(check.onFail, { stdio: "inherit" });
    } else if (typeof check.onFail === "function") {
      await check.onFail({ check, error });
    }
    return true;
  } catch {
    return false;
  }
}

/** Label describing the fixer, for prompts and logs. */
function fixLabel(check: GreenlyCheck): string {
  return typeof check.onFail === "string" ? `"${check.onFail}"` : "the fix function";
}

/** The fixer's command text, for the "$ ..." line shown before it runs. */
function fixCommand(check: GreenlyCheck): string {
  return typeof check.onFail === "string" ? check.onFail : "fix function";
}

/**
 * Run all checks sequentially: stdout streams live, failures print their
 * buffered stderr, and fixable checks prompt (via clack) before running.
 */
export async function runChecks(config: GreenlyConfig, options: RunOptions = {}): Promise<RunResult> {
  const { autoFix = false, interactive = true } = options;

  const name = config.name ?? "greenly";
  const width = bannerWidth(name);
  const rule = (char: string) => char.repeat(width);

  console.log();
  console.log(colors.cyan(colors.bold(rule("═"))));
  console.log(colors.cyan(colors.bold(center(name, width))));
  console.log(colors.cyan(colors.bold(rule("═"))));
  console.log();

  const results: CheckResult[] = [];

  for (const check of config.checks) {
    console.log(colors.bold(colors.yellow(`▶ ${check.name}`)));
    console.log(`  ${colors.cyan(commandLine(check.command))}\n`);

    const { ok, stdout, stderr, error } = await runCommand(check.command);

    // Only stdout: linters report there, while stderr carries Node / package-manager warnings.
    if (ok && !check.ignoreWarnings && hasWarnings(stdout)) {
      console.log(`\n${colors.yellow(`⚠ WARNINGS: ${check.name}`)}`);
      console.log(colors.yellow(`  Exited successfully but reported warnings.`));
      results.push({ name: check.name, status: "warnings" });
      console.log("\n" + colors.dim(rule("─")) + "\n");
      continue;
    }

    if (ok) {
      console.log(`\n${colors.green(`✔ PASSED: ${check.name}`)}\n`);
      results.push({ name: check.name, status: "passed" });
      console.log(colors.dim(rule("─")) + "\n");
      continue;
    }

    if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
    console.log(`\n${colors.red(`✖ FAILED: ${check.name}`)}`);

    // No fixer available.
    if (check.onFail === undefined) {
      if (check.optional) {
        console.log(colors.yellow(`  ${check.name} is optional, continuing.`));
      }
      results.push({ name: check.name, status: check.optional ? "warned" : "failed" });
      console.log("\n" + colors.dim(rule("─")) + "\n");
      continue;
    }

    // Decide whether to run the fixer.
    let shouldFix = autoFix;
    if (!autoFix && interactive) {
      const answer = await confirm({
        message: `Run ${fixLabel(check)} to fix ${colors.bold(check.name)}?`,
        initialValue: true,
      });
      if (isCancel(answer)) {
        cancel("Aborted.");
        const failedSoFar = results.filter((r) => r.status === "failed").length;
        const warningsSoFar = results.filter((r) => r.status === "warnings").length;
        return { results, failed: failedSoFar, warnings: warningsSoFar, exitCode: 1 };
      }
      shouldFix = answer;
    }

    if (!shouldFix) {
      if (!interactive && !autoFix) {
        console.log(colors.dim(`  Fixer available, re-run with --yes to auto-fix.`));
      } else {
        console.log(colors.yellow(`  Skipped fix.`));
      }
      results.push({ name: check.name, status: check.optional ? "warned" : "failed" });
      console.log("\n" + colors.dim(rule("─")) + "\n");
      continue;
    }

    console.log(`\n  ${colors.cyan(`$ ${fixCommand(check)}`)}\n`);
    if (await runFix(check, error)) {
      console.log(`\n${colors.green(`✔ Auto-fixed: ${check.name}`)}\n`);
      results.push({ name: check.name, status: "fixed" });
    } else {
      console.log(`\n${colors.red(`  Auto-fix failed for ${check.name}, please fix manually.`)}\n`);
      results.push({ name: check.name, status: check.optional ? "warned" : "failed" });
    }
    console.log(colors.dim(rule("─")) + "\n");
  }

  const passed = results.filter((r) => r.status === "passed" || r.status === "fixed").length;
  const warned = results.filter((r) => r.status === "warned").length;
  const warningResults = results.filter((r) => r.status === "warnings");
  const warnings = warningResults.length;
  const failedResults = results.filter((r) => r.status === "failed");
  const failed = failedResults.length;

  console.log(colors.cyan(colors.bold(rule("═"))));
  const summary =
    colors.green(`${passed} passed`) +
    (warnings > 0 ? colors.dim(", ") + colors.yellow(`${warnings} with warnings`) : "") +
    (warned > 0 ? colors.dim(", ") + colors.yellow(`${warned} warned`) : "") +
    colors.dim(", ") +
    (failed > 0 ? colors.red(`${failed} failed`) : colors.dim("0 failed"));
  console.log(colors.bold(`   Results: ${summary}`));

  if (warnings > 0) {
    console.log(`\n${colors.yellow(colors.bold("Checks with warnings:"))}`);
    for (const r of warningResults) console.log(colors.yellow(`  • ${r.name}`));
  }

  if (failed > 0) {
    console.log(`\n${colors.red(colors.bold("Failed checks:"))}`);
    for (const r of failedResults) console.log(colors.red(`  • ${r.name}`));
    console.log(`\n${colors.red(colors.bold("⚠  Fix the issues above before continuing."))}\n`);
  } else if (warnings > 0) {
    console.log(`\n${colors.yellow(colors.bold("⚠  No failures, but some checks reported warnings."))}\n`);
  } else {
    console.log(`\n${colors.green(colors.bold("✔  All checks passed!"))}\n`);
  }

  return { results, failed, warnings, exitCode: failed > 0 ? 1 : 0 };
}
