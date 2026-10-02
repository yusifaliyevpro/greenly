import { describe, expect, it } from "vitest";
import { checkSlug, reservedChecks, selectChecks } from "../src/lib/select";

const checks = [
  { name: "TypeScript", command: "tsc" },
  { name: "Oxlint", command: "oxlint" },
  { name: "Expo Doctor", command: "expo-doctor" },
  { name: "Tests", command: "vitest" },
];

describe("checkSlug", () => {
  it("lowercases and joins words with dashes", () => {
    expect(checkSlug("TypeScript")).toBe("typescript");
    expect(checkSlug("Expo Doctor")).toBe("expo-doctor");
    expect(checkSlug("  React   Doctor ")).toBe("react-doctor");
  });
});

describe("reservedChecks", () => {
  it("returns checks whose CLI name collides with a subcommand", () => {
    expect(reservedChecks([...checks, { name: "Init", command: "x" }]).map((c) => c.name)).toEqual(["Init"]);
    expect(reservedChecks(checks)).toEqual([]);
  });
});

describe("selectChecks", () => {
  it("returns every check when no names are given", () => {
    expect(selectChecks(checks, [])).toEqual({ selected: checks, unknown: [] });
  });

  it("selects by slug in config order, case-insensitively", () => {
    const { selected, unknown } = selectChecks(checks, ["tests", "Expo-Doctor", "typescript"]);
    expect(selected.map((c) => c.name)).toEqual(["TypeScript", "Expo Doctor", "Tests"]);
    expect(unknown).toEqual([]);
  });

  it("reports names that match no check", () => {
    expect(selectChecks(checks, ["oxlint", "lnit"]).unknown).toEqual(["lnit"]);
  });
});
