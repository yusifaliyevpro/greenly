import { describe, expect, it } from "vitest";
import { parseArgs, parseLogsArgs, resolveMode } from "../src/lib/args";

describe("parseArgs", () => {
  it("detects help and version", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("detects autoFix from -y / --yes / --fix", () => {
    expect(parseArgs(["-y"]).autoFix).toBe(true);
    expect(parseArgs(["--yes"]).autoFix).toBe(true);
    expect(parseArgs(["--fix"]).autoFix).toBe(true);
    expect(parseArgs([]).autoFix).toBe(false);
  });

  it("collects unknown flags", () => {
    expect(parseArgs(["--fxi", "oxlint", "-y"]).unknown).toEqual(["--fxi"]);
    expect(parseArgs(["-y", "--no-fix", "-h", "-v", "--strict"]).unknown).toEqual([]);
  });

  it("collects positionals as check names", () => {
    expect(parseArgs(["oxlint", "--strict", "tests"]).names).toEqual(["oxlint", "tests"]);
    expect(parseArgs(["-y"]).names).toEqual([]);
  });

  it("turns hints off with --no-hints", () => {
    expect(parseArgs([]).hints).toBe(true);
    expect(parseArgs(["--no-hints"]).hints).toBe(false);
    expect(parseArgs(["--no-hints"]).unknown).toEqual([]);
  });

  it("detects --strict", () => {
    expect(parseArgs(["--strict"]).strict).toBe(true);
    expect(parseArgs([]).strict).toBe(false);
  });

  it("lets --no-fix override --yes", () => {
    const parsed = parseArgs(["--yes", "--no-fix"]);
    expect(parsed.noFix).toBe(true);
    expect(parsed.autoFix).toBe(false);
  });
});

describe("resolveMode", () => {
  it("prompts only on a TTY with no fix flags", () => {
    expect(resolveMode(parseArgs([]), true)).toEqual({
      autoFix: false,
      interactive: true,
      strict: false,
      bail: false,
      output: "stream",
    });
    expect(resolveMode(parseArgs([]), false)).toEqual({
      autoFix: false,
      interactive: false,
      strict: false,
      bail: false,
      output: "stream",
    });
  });

  it("never prompts when autoFix is set", () => {
    expect(resolveMode(parseArgs(["-y"]), true)).toEqual({
      autoFix: true,
      interactive: false,
      strict: false,
      bail: false,
      output: "stream",
    });
  });

  it("never prompts or fixes with --no-fix", () => {
    expect(resolveMode(parseArgs(["--no-fix"]), true)).toEqual({
      autoFix: false,
      interactive: false,
      strict: false,
      bail: false,
      output: "stream",
    });
  });

  it("passes --strict through", () => {
    expect(resolveMode(parseArgs(["--strict"]), false).strict).toBe(true);
  });
});

describe("new run flags", () => {
  it("parses --bail, --failed, --json, --verbose and -nh", () => {
    const parsed = parseArgs(["--bail", "--failed", "--json", "--verbose", "-nh"]);
    expect(parsed).toMatchObject({ bail: true, failed: true, json: true, verbose: true, hints: false });
    expect(parsed.unknown).toEqual([]);
  });

  it("uses compact output for agents unless --verbose", () => {
    expect(resolveMode(parseArgs([]), false, true).output).toBe("compact");
    expect(resolveMode(parseArgs(["--verbose"]), false, true).output).toBe("stream");
    expect(resolveMode(parseArgs([]), false, false).output).toBe("stream");
  });

  it("never prompts with --json", () => {
    expect(resolveMode(parseArgs(["--json"]), true, true)).toMatchObject({ output: "json", interactive: false });
  });
});

describe("parseLogsArgs", () => {
  it("parses names and flags", () => {
    expect(parseLogsArgs(["oxlint", "--failed", "--json"])).toEqual({
      help: false,
      failed: true,
      json: true,
      names: ["oxlint"],
      unknown: [],
    });
  });

  it("rejects unknown flags", () => {
    expect(parseLogsArgs(["--tail", "5"]).unknown).toEqual(["--tail"]);
  });
});
