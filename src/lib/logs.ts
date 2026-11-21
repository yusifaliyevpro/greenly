import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { checkSlug } from "./select";
import type { GreenlyCheck } from "./types";

/** Where a project's saved run lives (relative to the config folder). */
export const CACHE_DIR = join("node_modules", ".cache", "greenly");

/** `not-run`: skipped by `--bail`, or the run stopped before reaching it. */
export type LogStatus = "passed" | "fixed" | "failed" | "warned" | "not-run";

export type LogEntry = {
  name: string;
  slug: string;
  /** The shell command, or `name()` for a function command. */
  command: string;
  status: LogStatus;
  reason?: "warnings" | "optional";
  durationMs?: number;
  finishedAt?: string;
  /** Log file path, relative to the cache folder. */
  file: string;
  /** Output lines in the log file. */
  lines: number;
  /** Whether earlier output was dropped (only the last 1 MiB is kept). */
  truncated: boolean;
};

export type Manifest = {
  version: 1;
  /** When the last run (full or partial) started. */
  updatedAt: string;
  /** One entry per check, in config order. */
  checks: LogEntry[];
};

export type RecordInput = {
  status: LogStatus;
  reason?: "warnings" | "optional";
  durationMs: number;
  /** Output, already stripped of ANSI codes. */
  output: string;
  truncated: boolean;
};

/** Checks the next `--failed` run should pick: failed, warned or not run. */
export function needsRerun(manifest: Manifest): string[] {
  return manifest.checks.filter((c) => c.status !== "passed" && c.status !== "fixed").map((c) => c.slug);
}

/** Number of lines in `text`, ignoring one trailing newline. */
export function countLines(text: string): number {
  if (text === "") return 0;
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/** "1 line", "12 lines". */
export function lineCount(n: number): string {
  return `${n} line${n === 1 ? "" : "s"}`;
}

/** Safe file name for a check's log. */
export function logFileName(slug: string): string {
  return `${slug.replace(/[^a-z0-9._-]/g, "_")}.log`;
}

/** Display form of a check's command. */
export function commandText(command: GreenlyCheck["command"]): string {
  if (typeof command === "string") return command;
  return command.name ? `${command.name}()` : "(function)";
}

function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "version") === 1 &&
    Array.isArray(Reflect.get(value, "checks"))
  );
}

/** Read the saved manifest, or `null` when there is none (or it is unreadable). */
export function readManifest(dir: string): Manifest | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, "last-run.json"), "utf8"));
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write via a temp file + rename, so a reader never sees a half-written file. */
function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  try {
    renameSync(tmp, path);
  } catch {
    // Windows can refuse the rename while another process has the file open.
    writeFileSync(path, content);
    rmSync(tmp, { force: true });
  }
}

/**
 * Saves each check's last output to `<dir>/logs/<slug>.log` plus a
 * `last-run.json` manifest. Write errors are swallowed so logging never breaks a run.
 */
export class LogStore {
  private manifest: Manifest = { version: 1, updatedAt: "", checks: [] };

  /** `displayBase`: folder log paths are shown relative to (where greenly was started). */
  constructor(
    readonly dir: string,
    private readonly displayBase: string = process.cwd(),
  ) {}

  /**
   * Start a run. A full run replaces every log; a partial run resets only the
   * `selected` checks and keeps the others. Entries follow `all` (config order).
   */
  begin(all: GreenlyCheck[], selected: GreenlyCheck[], full: boolean): void {
    const previous = full ? [] : (readManifest(this.dir)?.checks ?? []);
    const bySlug = new Map(previous.map((e) => [e.slug, e]));
    const selectedSlugs = new Set(selected.map((c) => checkSlug(c.name)));
    for (const check of selected) {
      const slug = checkSlug(check.name);
      bySlug.set(slug, {
        name: check.name,
        slug,
        command: commandText(check.command),
        status: "not-run",
        file: join("logs", logFileName(slug)),
        lines: 0,
        truncated: false,
      });
    }
    const checks = all.map((c) => bySlug.get(checkSlug(c.name))).filter((e) => e !== undefined);
    this.manifest = { version: 1, updatedAt: new Date().toISOString(), checks };

    this.safely(() => {
      if (full) rmSync(join(this.dir, "logs"), { recursive: true, force: true });
      mkdirSync(join(this.dir, "logs"), { recursive: true });
      for (const slug of selectedSlugs) rmSync(this.pathFor(slug), { force: true });
      this.writeManifest();
    });
  }

  /** Absolute path of a check's log file. */
  pathFor(slug: string): string {
    return join(this.dir, "logs", logFileName(slug));
  }

  /** A log path as shown to the user. */
  display(path: string): string {
    return relative(this.displayBase, path).replaceAll("\\", "/");
  }

  /** Save a finished check's output and update the manifest. */
  record(check: GreenlyCheck, input: RecordInput): void {
    const slug = checkSlug(check.name);
    const entry = this.manifest.checks.find((e) => e.slug === slug);
    if (!entry) return;
    Object.assign(entry, {
      status: input.status,
      reason: input.reason,
      durationMs: Math.round(input.durationMs),
      finishedAt: new Date().toISOString(),
      lines: countLines(input.output),
      truncated: input.truncated,
    });
    const header =
      `# greenly: ${check.name}, ${input.status}${input.reason ? ` (${input.reason})` : ""}, ` +
      `${entry.durationMs}ms, ${entry.finishedAt}\n# $ ${entry.command}\n` +
      (input.truncated ? "# [earlier output truncated, only the last 1 MiB is kept]\n" : "") +
      "\n";
    this.safely(() => {
      writeAtomic(this.pathFor(slug), header + input.output);
      this.writeManifest();
    });
  }

  private writeManifest(): void {
    writeAtomic(join(this.dir, "last-run.json"), JSON.stringify(this.manifest, null, 2) + "\n");
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Saving logs is best-effort (read-only node_modules, locked file, ...).
    }
  }
}
