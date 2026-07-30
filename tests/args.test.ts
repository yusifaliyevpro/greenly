import { describe, expect, it } from "vitest";
import { parseArgs, resolveMode } from "../src/lib/args";

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

  it("lets --no-fix override --yes", () => {
    const parsed = parseArgs(["--yes", "--no-fix"]);
    expect(parsed.noFix).toBe(true);
    expect(parsed.autoFix).toBe(false);
  });
});

describe("resolveMode", () => {
  it("prompts only on a TTY with no fix flags", () => {
    expect(resolveMode(parseArgs([]), true)).toEqual({ autoFix: false, interactive: true });
    expect(resolveMode(parseArgs([]), false)).toEqual({ autoFix: false, interactive: false });
  });

  it("never prompts when autoFix is set", () => {
    expect(resolveMode(parseArgs(["-y"]), true)).toEqual({ autoFix: true, interactive: false });
  });

  it("never prompts or fixes with --no-fix", () => {
    expect(resolveMode(parseArgs(["--no-fix"]), true)).toEqual({ autoFix: false, interactive: false });
  });
});
