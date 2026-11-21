import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogStore, countLines, lineCount, logFileName, needsRerun, readManifest } from "../src/lib/logs";
import { logBody, showLogs, timeAgo } from "../src/lib/show-logs";
import type { GreenlyCheck } from "../src/lib/types";

let root: string;
let dir: string;

const checks: GreenlyCheck[] = [
  { name: "TypeScript", command: "tsc" },
  { name: "Oxlint", command: "oxlint" },
  { name: "Tests", command: "vitest" },
];

const done = { durationMs: 1200, truncated: false };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "greenly-logs-"));
  dir = join(root, "node_modules", ".cache", "greenly");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("helpers", () => {
  it("counts lines, ignoring one trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\r\nb")).toBe(2);
  });

  it("pluralizes line counts", () => {
    expect(lineCount(1)).toBe("1 line");
    expect(lineCount(0)).toBe("0 lines");
    expect(lineCount(12)).toBe("12 lines");
  });

  it("makes safe log file names", () => {
    expect(logFileName("expo-doctor")).toBe("expo-doctor.log");
    expect(logFileName("a/b:c")).toBe("a_b_c.log");
  });

  it("strips greenly's header from a log", () => {
    expect(logBody("# greenly: A, failed\n# $ x\n\nboom\n")).toBe("boom");
    expect(logBody("raw\n")).toBe("raw");
  });

  it("formats ages", () => {
    const now = Date.parse("2026-01-01T00:10:00Z");
    expect(timeAgo("2026-01-01T00:09:58Z", now)).toBe("just now");
    expect(timeAgo("2026-01-01T00:09:00Z", now)).toBe("1m ago");
    expect(timeAgo("2025-12-31T22:10:00Z", now)).toBe("2h ago");
  });
});

describe("LogStore", () => {
  it("saves each check's output and a manifest", () => {
    const store = new LogStore(dir, root);
    store.begin(checks, checks, true);
    store.record(checks[1], { ...done, status: "failed", output: "error a\nerror b\n" });

    const manifest = readManifest(dir);
    expect(manifest?.checks.map((c) => [c.slug, c.status])).toEqual([
      ["typescript", "not-run"],
      ["oxlint", "failed"],
      ["tests", "not-run"],
    ]);
    expect(manifest?.checks[1]).toMatchObject({ lines: 2, durationMs: 1200, command: "oxlint" });
    expect(logBody(readFileSync(store.pathFor("oxlint"), "utf8"))).toBe("error a\nerror b");
    expect(store.display(store.pathFor("oxlint"))).toBe("node_modules/.cache/greenly/logs/oxlint.log");
  });

  it("a partial run replaces only the selected checks", () => {
    const full = new LogStore(dir, root);
    full.begin(checks, checks, true);
    for (const check of checks) full.record(check, { ...done, status: "failed", output: `${check.name} out` });

    const partial = new LogStore(dir, root);
    partial.begin(checks, [checks[1]], false);
    partial.record(checks[1], { ...done, status: "passed", output: "clean" });

    const manifest = readManifest(dir);
    expect(manifest?.checks.map((c) => c.status)).toEqual(["failed", "passed", "failed"]);
    expect(logBody(readFileSync(full.pathFor("typescript"), "utf8"))).toBe("TypeScript out");
    expect(logBody(readFileSync(full.pathFor("oxlint"), "utf8"))).toBe("clean");
  });

  it("a full run removes logs of checks no longer in the config", () => {
    const first = new LogStore(dir, root);
    first.begin(checks, checks, true);
    first.record(checks[2], { ...done, status: "passed", output: "ok" });

    const second = new LogStore(dir, root);
    second.begin(checks.slice(0, 2), checks.slice(0, 2), true);
    expect(existsSync(first.pathFor("tests"))).toBe(false);
    expect(readManifest(dir)?.checks.map((c) => c.slug)).toEqual(["typescript", "oxlint"]);
  });

  it("picks failed, warned and not-run checks for --failed", () => {
    const store = new LogStore(dir, root);
    store.begin(checks, checks, true);
    store.record(checks[0], { ...done, status: "passed", output: "" });
    store.record(checks[1], { ...done, status: "warned", reason: "warnings", output: "" });
    expect(needsRerun(readManifest(dir)!)).toEqual(["oxlint", "tests"]);
  });

  it("returns null for a missing or broken manifest", () => {
    expect(readManifest(dir)).toBeNull();
    new LogStore(dir, root).begin(checks, checks, true);
    writeFileSync(join(dir, "last-run.json"), "{not json");
    expect(readManifest(dir)).toBeNull();
  });
});

describe("showLogs", () => {
  let out: string[];

  beforeEach(() => {
    out = [];
    vi.spyOn(console, "log").mockImplementation((text?: string) => void out.push(text ?? ""));
    vi.spyOn(console, "error").mockImplementation((text?: string) => void out.push(text ?? ""));
    writeFileSync(join(root, "greenly.config.json"), "{}");
    const store = new LogStore(dir, root);
    store.begin(checks, checks, true);
    store.record(checks[0], { ...done, status: "passed", output: "fine\n" });
    store.record(checks[1], { ...done, status: "failed", output: "lint error\n" });
  });
  afterEach(() => vi.restoreAllMocks());

  const args = { help: false, failed: false, json: false, names: [] as string[], unknown: [] };

  it("summarizes the last run without printing log contents", () => {
    expect(showLogs(args, root)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("typescript");
    expect(text).toContain("node_modules/.cache/greenly/logs/oxlint.log");
    expect(text).not.toContain("lint error");
  });

  it("prints a named check's log", () => {
    expect(showLogs({ ...args, names: ["oxlint"] }, root)).toBe(0);
    expect(out.join("\n")).toContain("lint error");
  });

  it("prints failed and not-run checks with --failed", () => {
    expect(showLogs({ ...args, failed: true }, root)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("lint error");
    expect(text).toContain("Tests");
    expect(text).not.toContain("fine");
  });

  it("errors for an unknown check or no saved run", () => {
    expect(showLogs({ ...args, names: ["nope"] }, root)).toBe(1);
    rmSync(dir, { recursive: true, force: true });
    expect(showLogs(args, root)).toBe(1);
  });
});
