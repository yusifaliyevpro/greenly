import { describe, expect, it } from "vitest";
import { hasWarnings } from "../src/lib/warnings";

describe("hasWarnings", () => {
  it("detects oxlint's default summary", () => {
    expect(hasWarnings("  ! eslint(no-debugger)\n\nFound 2 warnings and 0 errors.\nFinished in 15ms")).toBe(true);
    expect(hasWarnings("Found 1 warning and 0 errors.")).toBe(true);
  });

  it("detects oxlint's default summary through ANSI colors", () => {
    expect(hasWarnings("Found \x1b[33m2\x1b[0m warnings and 0 errors.")).toBe(true);
  });

  it("detects oxlint's agent format", () => {
    expect(hasWarnings("a.js:2:7: warning eslint(no-unused-vars): Variable 'unused' is declared")).toBe(true);
  });

  it("detects oxlint's unix format", () => {
    expect(hasWarnings("a.js:1:1: `debugger` statement is not allowed [Warning/eslint(no-debugger)]")).toBe(true);
  });

  it("detects GitHub warning annotations", () => {
    expect(hasWarnings("::warning file=a.js,line=1,col=1::a.js:1:1: oops")).toBe(true);
  });

  it("detects ESLint stylish summaries", () => {
    expect(hasWarnings("\x1b[33m✖ 2 problems (0 errors, 2 warnings)\x1b[0m")).toBe(true);
  });

  it("ignores Node's own process warnings", () => {
    const node =
      "(node:25260) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/proj/oxfmt.config.ts?cache=1790963441622 is not specified.\n" +
      'To eliminate this warning, add "type": "module" to C:\\proj\\package.json.\n' +
      "(Use `node --trace-warnings ...` to show where the warning was created)";
    expect(hasWarnings(node)).toBe(false);
    expect(hasWarnings("(node:1) ExperimentalWarning: Type Stripping is an experimental feature")).toBe(false);
  });

  it("ignores a count of warnings outside a linter summary", () => {
    expect(hasWarnings(" ✓ tests/parse.test.ts > returns 2 warnings for bad input 1ms")).toBe(false);
    expect(hasWarnings("Built in 3s, 12 warnings suppressed by config")).toBe(false);
  });

  it("ignores clean output and zero counts", () => {
    expect(hasWarnings("")).toBe(false);
    expect(hasWarnings("Found 0 warnings and 0 errors.\nFinished in 9ms")).toBe(false);
    expect(hasWarnings("✖ 1 problem (1 error, 0 warnings)")).toBe(false);
    expect(hasWarnings(" Test Files  3 passed (3)\n      Tests  42 passed (42)")).toBe(false);
  });
});
