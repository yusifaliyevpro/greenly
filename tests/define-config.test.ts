import { defineConfig } from "greenly";
import { describe, expect, it } from "vitest";

describe("defineConfig", () => {
  it("returns the config unchanged (identity for type inference)", () => {
    const cfg = { name: "X", checks: [{ name: "A", command: "echo a" }] };
    expect(defineConfig(cfg)).toBe(cfg);
  });
});
