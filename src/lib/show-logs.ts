import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { LogsArgs } from "./args";
import { colors } from "./colors";
import { ConfigNotFoundError, findConfigFile } from "./config";
import { CACHE_DIR, lineCount, needsRerun, readManifest } from "./logs";
import type { LogEntry, LogStatus } from "./logs";
import { formatDuration } from "./runner";
import { checkSlug } from "./select";

const ICON: Record<LogStatus, string> = {
  passed: colors.green("✔"),
  fixed: colors.green("✔"),
  warned: colors.yellow("⚠"),
  failed: colors.red("✖"),
  "not-run": colors.dim("-"),
};

/** "just now", "42s ago", "3m ago", "5h ago", "2d ago". */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** A log file's output, without greenly's `# ...` header. */
export function logBody(content: string): string {
  const start = content.startsWith("# greenly:") ? content.indexOf("\n\n") : -1;
  return (start === -1 ? content : content.slice(start + 2)).replace(/\s+$/, "");
}

function statusText(entry: LogEntry): string {
  if (entry.reason === "warnings") return "warnings";
  if (entry.reason === "optional") return "failed (optional)";
  return entry.status === "not-run" ? "not run" : entry.status;
}

/** `greenly logs`: print the last run's saved output. Returns the exit code. */
export function showLogs(args: LogsArgs, cwd: string = process.cwd()): number {
  const configFile = findConfigFile(cwd);
  if (!configFile) {
    console.error(colors.red(new ConfigNotFoundError(cwd).message));
    return 1;
  }
  const dir = join(dirname(configFile), CACHE_DIR);
  const manifest = readManifest(dir);
  if (!manifest) {
    console.error(colors.red("No saved run yet: logs are saved each time greenly runs checks."));
    return 1;
  }
  const display = (file: string) => relative(cwd, join(dir, file)).replaceAll("\\", "/");

  if (args.json) {
    const checks = manifest.checks.map((e) => ({ ...e, file: display(e.file) }));
    console.log(JSON.stringify({ ...manifest, checks }, null, 2));
    return 0;
  }

  if (args.names.length === 0 && !args.failed) {
    console.log(colors.bold(`Last run: ${timeAgo(manifest.updatedAt)}`));
    const width = Math.max(...manifest.checks.map((e) => e.slug.length));
    for (const e of manifest.checks) {
      const took = e.durationMs === undefined ? "" : formatDuration(e.durationMs);
      const details =
        e.status === "not-run"
          ? ""
          : `${took.padStart(7)}  ${lineCount(e.lines).padStart(11)}  ${colors.dim(display(e.file))}`;
      console.log(`  ${ICON[e.status]} ${e.slug.padEnd(width)}  ${statusText(e).padEnd(17)}${details}`);
    }
    return 0;
  }

  const wanted = new Set(args.names.map(checkSlug));
  const unknown = [...wanted].filter((slug) => !manifest.checks.some((e) => e.slug === slug));
  if (unknown.length > 0) {
    console.error(colors.red(`No saved log for: ${unknown.join(", ")}`));
    console.error(`Saved checks: ${manifest.checks.map((e) => e.slug).join(", ")}`);
    return 1;
  }
  if (args.failed) for (const slug of needsRerun(manifest)) wanted.add(slug);
  const entries = manifest.checks.filter((e) => wanted.has(e.slug));
  if (entries.length === 0) {
    console.log("No failed, warned or not-run checks in the last run.");
    return 0;
  }

  for (const e of entries) {
    const meta = [statusText(e), e.durationMs === undefined ? "" : formatDuration(e.durationMs), timeAgo(e.finishedAt)]
      .filter(Boolean)
      .join(", ");
    console.log(colors.bold(`── ${e.name}: ${meta} ── ${colors.dim(display(e.file))}`));
    if (e.status === "not-run") {
      console.log(colors.dim("(not run)\n"));
      continue;
    }
    let content = "";
    try {
      content = readFileSync(join(dir, e.file), "utf8");
    } catch {
      console.log(colors.dim("(log file missing)\n"));
      continue;
    }
    const body = logBody(content);
    console.log(body === "" ? colors.dim("(no output)") : body);
    console.log();
  }
  return 0;
}
