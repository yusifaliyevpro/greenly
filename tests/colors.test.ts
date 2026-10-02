import { describe, expect, it } from "vitest";
import { shouldUseColor } from "../src/lib/colors";

describe("shouldUseColor", () => {
  it("follows the TTY by default", () => {
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
  });

  it("treats any FORCE_COLOR other than 0/false as on", () => {
    for (const value of ["", "1", "2", "3", "true"]) expect(shouldUseColor({ FORCE_COLOR: value }, false)).toBe(true);
  });

  it("turns colors off with FORCE_COLOR=0 or false, even on a TTY", () => {
    expect(shouldUseColor({ FORCE_COLOR: "0" }, true)).toBe(false);
    expect(shouldUseColor({ FORCE_COLOR: "false" }, true)).toBe(false);
  });

  it("turns colors off with a non-empty NO_COLOR", () => {
    expect(shouldUseColor({ NO_COLOR: "1" }, true)).toBe(false);
    expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
    expect(shouldUseColor({ NO_COLOR: "" }, true)).toBe(true);
  });
});
