import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGreenlyConfig } from "../src/lib/config";
import {
  availablePresets,
  buildChecks,
  CHECK_PRESETS,
  configFileName,
  declaredGreenlyVersion,
  greenlyLocation,
  installedDependencies,
  packageScripts,
  pmContext,
  renderConfig,
  shouldOfferInstall,
  withCheckScript,
} from "../src/lib/init";
import type { GeneratedCheck } from "../src/lib/init";
import { detectPackageManager, installCommand } from "../src/lib/utils";

describe("detectPackageManager", () => {
  it("prefers the invoking agent", () => {
    expect(detectPackageManager("pnpm/9.0.0 npm/? node/v24", [])).toBe("pnpm");
    expect(detectPackageManager("yarn/4.0.0", [])).toBe("yarn");
    expect(detectPackageManager("bun/1.1.0", [])).toBe("bun");
    expect(detectPackageManager("npm/10.0.0", [])).toBe("npm");
  });

  it("falls back to lockfiles", () => {
    expect(detectPackageManager(undefined, ["pnpm-lock.yaml"])).toBe("pnpm");
    expect(detectPackageManager("", ["yarn.lock"])).toBe("yarn");
    expect(detectPackageManager("", ["bun.lockb"])).toBe("bun");
    expect(detectPackageManager("", ["package-lock.json"])).toBe("npm");
  });

  it("defaults to npm", () => {
    expect(detectPackageManager(undefined, [])).toBe("npm");
  });
});

describe("installCommand", () => {
  it("maps each package manager", () => {
    expect(installCommand("pnpm")).toBe("pnpm add -D greenly@latest");
    expect(installCommand("yarn")).toBe("yarn add -D greenly@latest");
    expect(installCommand("bun")).toBe("bun add -d greenly@latest");
    expect(installCommand("npm")).toBe("npm install -D greenly@latest");
  });
});

describe("buildChecks", () => {
  it("builds selected checks in catalog order with pnpm prefixes", () => {
    const checks = buildChecks(["oxfmt", "typescript"], "pnpm");
    // catalog order: typescript before oxfmt, regardless of selection order
    expect(checks.map((c) => c.name)).toEqual(["TypeScript", "Oxfmt"]);
    expect(checks[0]).toEqual({ name: "TypeScript", command: "pnpm tsc --noEmit" });
    expect(checks[1]).toEqual({ name: "Oxfmt", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" });
  });

  it("runs local tools with the run prefix, external doctors with the exec prefix", () => {
    // Local tools are run through the package manager (no npx/bunx).
    expect(buildChecks(["eslint"], "npm")[0]).toEqual({
      name: "ESLint",
      command: "npm run eslint .",
    });
    expect(buildChecks(["typescript"], "bun")[0].command).toBe("bun run tsc --noEmit");
    // External doctor tools (not installed locally) still use the exec prefix.
    expect(buildChecks(["expo-doctor"], "npm")[0].command).toBe("npx expo-doctor");
    expect(buildChecks(["react-doctor"], "pnpm")[0].command).toBe("pnpx react-doctor --verbose");
  });

  it("runs react-doctor with the run prefix when it is installed, else the exec prefix", () => {
    // Not installed -> exec prefix (npx / pnpx).
    expect(buildChecks(["react-doctor"], "npm")[0].command).toBe("npx react-doctor --verbose");
    expect(buildChecks(["react-doctor"], "pnpm", { deps: new Set(["react"]) })[0].command).toBe(
      "pnpx react-doctor --verbose",
    );
    // Installed as a dependency -> run prefix (npm run / pnpm).
    expect(buildChecks(["react-doctor"], "npm", { deps: new Set(["react-doctor"]) })[0].command).toBe(
      "npm run react-doctor --verbose",
    );
    expect(buildChecks(["react-doctor"], "pnpm", { deps: new Set(["react-doctor"]) })[0].command).toBe(
      "pnpm react-doctor --verbose",
    );
  });

  it("uses the run prefix for the build script", () => {
    expect(buildChecks(["build"], "pnpm")[0].command).toBe("pnpm build");
    expect(buildChecks(["build"], "npm")[0].command).toBe("npm run build");
    expect(buildChecks(["build"], "bun")[0].command).toBe("bun run build");
  });

  it("ignores unknown ids", () => {
    expect(buildChecks(["nope"], "pnpm")).toEqual([]);
  });

  it("orders formatters before linters", () => {
    expect(buildChecks(["oxlint", "oxfmt"], "pnpm").map((c) => c.name)).toEqual(["Oxfmt", "Oxlint"]);
    expect(buildChecks(["eslint", "prettier", "typescript"], "pnpm").map((c) => c.name)).toEqual([
      "TypeScript",
      "Prettier",
      "ESLint",
    ]);
  });

  it("prefers matching package.json scripts over raw tool commands", () => {
    const scripts = new Set(["fmt:check", "fmt", "lint", "lint:fix", "test", "build", "typecheck"]);
    expect(buildChecks(["oxfmt"], "pnpm", { scripts })[0]).toEqual({
      name: "Oxfmt",
      command: "pnpm fmt:check",
      onFail: "pnpm fmt",
    });
    expect(buildChecks(["oxlint"], "pnpm", { scripts })[0]).toEqual({
      name: "Oxlint",
      command: "pnpm lint",
    });
    expect(buildChecks(["vitest"], "pnpm", { scripts })[0].command).toBe("pnpm test");
    expect(buildChecks(["typescript"], "pnpm", { scripts })[0].command).toBe("pnpm typecheck");
  });

  it("uses the run prefix for scripts and falls back per field", () => {
    // Only the check script exists; the fix falls back to the raw tool command.
    const scripts = new Set(["fmt:check"]);
    expect(buildChecks(["oxfmt"], "npm", { scripts })[0]).toEqual({
      name: "Oxfmt",
      command: "npm run fmt:check",
      onFail: "npm run oxfmt",
    });
  });

  it("adds --incremental false to tsc when next is a dependency", () => {
    expect(buildChecks(["typescript"], "pnpm", { deps: new Set(["next"]) })[0].command).toBe(
      "pnpm tsc --noEmit --incremental false",
    );
    expect(buildChecks(["typescript"], "pnpm", { deps: new Set(["react"]) })[0].command).toBe("pnpm tsc --noEmit");
    expect(buildChecks(["typescript"], "pnpm")[0].command).toBe("pnpm tsc --noEmit");
  });
});

describe("pmContext", () => {
  it("maps each package manager to its exec/run prefixes", () => {
    expect(pmContext("pnpm")).toEqual({ exec: "pnpx", run: "pnpm" });
    expect(pmContext("yarn")).toEqual({ exec: "yarn dlx", run: "yarn" });
    expect(pmContext("bun")).toEqual({ exec: "bunx", run: "bun run" });
    expect(pmContext("npm")).toEqual({ exec: "npx", run: "npm run" });
  });
});

describe("packageScripts", () => {
  it("collects script names", () => {
    const set = packageScripts({ scripts: { "fmt:check": "oxfmt --check", lint: "oxlint" } });
    expect(set.has("fmt:check")).toBe(true);
    expect(set.has("lint")).toBe(true);
  });

  it("handles missing scripts / package.json", () => {
    expect(packageScripts({ name: "x" }).size).toBe(0);
    expect(packageScripts(null).size).toBe(0);
  });
});

describe("greenlyLocation", () => {
  it("finds greenly in devDependencies (preferred)", () => {
    expect(greenlyLocation({ devDependencies: { greenly: "1" } })).toBe("dev");
    expect(greenlyLocation({ dependencies: { greenly: "1" }, devDependencies: { greenly: "1" } })).toBe("dev");
  });

  it("finds greenly in prod dependencies", () => {
    expect(greenlyLocation({ dependencies: { greenly: "1" } })).toBe("prod");
  });

  it("is none when absent or no package.json", () => {
    expect(greenlyLocation({ dependencies: { react: "19" } })).toBe("none");
    expect(greenlyLocation(null)).toBe("none");
  });
});

describe("declaredGreenlyVersion", () => {
  it("reads the range from package.json, preferring devDependencies", () => {
    expect(declaredGreenlyVersion({ devDependencies: { greenly: "^1.2.0" } })).toBe("^1.2.0");
    expect(declaredGreenlyVersion({ dependencies: { greenly: "1.0.0" } })).toBe("1.0.0");
    expect(declaredGreenlyVersion({ dependencies: { greenly: "1.0.0" }, devDependencies: { greenly: "^2.0.0" } })).toBe(
      "^2.0.0",
    );
  });

  it("is null when greenly is not declared", () => {
    expect(declaredGreenlyVersion({ devDependencies: { oxlint: "1" } })).toBeNull();
    expect(declaredGreenlyVersion(null)).toBeNull();
  });
});

describe("shouldOfferInstall", () => {
  it("skips only when greenly is a devDependency at the latest version", () => {
    expect(shouldOfferInstall({ location: "dev", declaredVersion: "1.2.0", latestVersion: "1.2.0" })).toBe(false);
    // A caret range at latest still counts as up to date.
    expect(shouldOfferInstall({ location: "dev", declaredVersion: "^1.2.0", latestVersion: "1.2.0" })).toBe(false);
    // Declared is ahead of latest -> still up to date.
    expect(shouldOfferInstall({ location: "dev", declaredVersion: "1.3.0", latestVersion: "1.2.0" })).toBe(false);
  });

  it("offers when the devDependency is outdated", () => {
    expect(shouldOfferInstall({ location: "dev", declaredVersion: "^1.0.0", latestVersion: "1.2.0" })).toBe(true);
  });

  it("offers when greenly is a prod dependency even at the latest version", () => {
    expect(shouldOfferInstall({ location: "prod", declaredVersion: "1.2.0", latestVersion: "1.2.0" })).toBe(true);
  });

  it("offers when greenly is not declared", () => {
    expect(shouldOfferInstall({ location: "none", declaredVersion: null, latestVersion: "1.2.0" })).toBe(true);
  });

  it("offers when the latest version could not be determined (offline)", () => {
    expect(shouldOfferInstall({ location: "dev", declaredVersion: "1.2.0", latestVersion: null })).toBe(true);
  });
});

describe("installedDependencies", () => {
  it("collects names from dependencies and devDependencies", () => {
    const set = installedDependencies({ dependencies: { next: "1" }, devDependencies: { oxlint: "1" } });
    expect(set.has("next")).toBe(true);
    expect(set.has("oxlint")).toBe(true);
    expect(set.has("missing")).toBe(false);
  });

  it("handles a missing package.json", () => {
    expect(installedDependencies(null).size).toBe(0);
  });
});

function shownPresetIds(installed: string[]): string[] {
  return availablePresets(new Set(installed)).map((p) => p.value);
}

describe("availablePresets", () => {
  const ids = shownPresetIds;

  it("hides dependency-gated presets when nothing is installed", () => {
    const shown = ids([]);
    expect(shown).not.toContain("oxlint");
    expect(shown).not.toContain("eslint");
    expect(shown).not.toContain("oxfmt");
    expect(shown).not.toContain("prettier");
    expect(shown).not.toContain("typescript");
    expect(shown).not.toContain("vitest");
    expect(shown).not.toContain("expo-doctor");
  });

  it("shows each tool independently when its dependency is present", () => {
    expect(ids(["oxlint"])).toEqual(["oxlint", "build"]);
    expect(ids(["eslint"])).toEqual(["eslint", "build"]);
    expect(ids(["oxfmt"])).toEqual(["oxfmt", "build"]);
    expect(ids(["prettier"])).toEqual(["prettier", "build"]);
  });

  it("does not pair competing tools: shows only the installed one", () => {
    const shown = ids(["oxlint", "oxfmt"]);
    expect(shown).toContain("oxlint");
    expect(shown).toContain("oxfmt");
    expect(shown).not.toContain("eslint");
    expect(shown).not.toContain("prettier");
  });

  it("shows both of a former pair when both are installed", () => {
    const shown = ids(["oxlint", "eslint"]);
    expect(shown).toContain("oxlint");
    expect(shown).toContain("eslint");
  });

  it("gates typescript, vitest, and expo-doctor on their dependencies", () => {
    expect(ids(["typescript"])).toContain("typescript");
    expect(ids(["vitest"])).toContain("vitest");
    expect(ids(["expo"])).toContain("expo-doctor");
  });

  it("always offers Build regardless of installed dependencies", () => {
    expect(ids([])).toContain("build");
    expect(ids(["eslint"])).toContain("build");
  });
});

describe("configFileName", () => {
  it("builds the file name", () => {
    expect(configFileName("ts")).toBe("greenly.config.ts");
    expect(configFileName("json")).toBe("greenly.config.json");
  });
});

const sampleChecks: GeneratedCheck[] = [
  { name: "TypeScript", command: "pnpm tsc --noEmit" },
  { name: "Oxfmt", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
];

describe("renderConfig", () => {
  it("renders an ESM/TS config with defineConfig", () => {
    const out = renderConfig({ name: "MyApp", checks: sampleChecks, ext: "ts", isModule: true });
    expect(out).toContain(`import { defineConfig } from "greenly";`);
    expect(out).toContain("export default defineConfig(");
    expect(out).toContain(`name: "MyApp"`);
    expect(out).toContain(`{ name: "TypeScript", command: "pnpm tsc --noEmit" }`);
    expect(out).toContain(`onFail: "pnpm oxfmt"`);
  });

  it("renders a CommonJS config for cjs/cts", () => {
    const out = renderConfig({ name: "MyApp", checks: sampleChecks, ext: "cjs", isModule: false });
    expect(out).toContain(`const { defineConfig } = require("greenly");`);
    expect(out).toContain("module.exports = defineConfig(");
  });

  it("respects package.json type for .js", () => {
    expect(renderConfig({ name: "X", checks: sampleChecks, ext: "js", isModule: true })).toContain("export default");
    expect(renderConfig({ name: "X", checks: sampleChecks, ext: "js", isModule: false })).toContain("module.exports");
  });

  it("always emits ESM for .mts and .mjs, ignoring package.json type", () => {
    for (const ext of ["mts", "mjs"] as const) {
      expect(renderConfig({ name: "X", checks: sampleChecks, ext, isModule: false })).toContain(
        "export default defineConfig(",
      );
    }
  });

  it("always emits CommonJS for .cts and .cjs, ignoring package.json type", () => {
    for (const ext of ["cts", "cjs"] as const) {
      expect(renderConfig({ name: "X", checks: sampleChecks, ext, isModule: true })).toContain(
        `const { defineConfig } = require("greenly");`,
      );
    }
  });

  it("renders JSON", () => {
    const out = renderConfig({ name: "MyApp", checks: sampleChecks, ext: "json", isModule: false });
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ name: "MyApp", checks: sampleChecks });
  });
});

describe("withCheckScript", () => {
  it("adds the script, preserving other fields and scripts", () => {
    const pkg = { name: "x", scripts: { build: "tsdown" } };
    const out = withCheckScript(pkg, "check");
    expect(out).toEqual({ name: "x", scripts: { build: "tsdown", check: "greenly" } });
    expect(pkg.scripts).toEqual({ build: "tsdown" }); // original untouched
  });

  it("creates scripts when missing and overwrites an existing key", () => {
    expect(withCheckScript({ name: "x" }, "check")).toEqual({ name: "x", scripts: { check: "greenly" } });
    expect(withCheckScript({ scripts: { ci: "old" } }, "ci")).toEqual({ scripts: { ci: "greenly" } });
  });
});

describe("CHECK_PRESETS", () => {
  it("exposes stable, unique ids", () => {
    const ids = CHECK_PRESETS.map((p) => p.value);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("typescript");
    expect(ids).toContain("prettier");
  });
});

// The generated .ts/.js/.cjs/.mjs configs `import { defineConfig } from "greenly"`,
// so the loader needs to resolve "greenly" from the temp dir. Drop a minimal
// (identity) shim into its node_modules for the round-trip to succeed.
async function writeGreenlyShim(root: string): Promise<void> {
  const pkgDir = join(root, "node_modules", "greenly");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "greenly", version: "0.0.0", main: "index.js" }));
  await writeFile(join(pkgDir, "index.js"), "exports.defineConfig = (c) => c;\n");
}

describe("generated config is loadable by greenly", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "greenly-init-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a JSON config the loader accepts", async () => {
    const checks = buildChecks(["typescript", "oxfmt"], "pnpm");
    const content = renderConfig({ name: "Roundtrip", checks, ext: "json", isModule: false });
    await writeFile(join(dir, "greenly.config.json"), content);

    const { config } = await loadGreenlyConfig(dir);
    expect(config.name).toBe("Roundtrip");
    expect(config.checks.map((c) => c.name)).toEqual(["TypeScript", "Oxfmt"]);
    expect(config.checks[1]).toMatchObject({ command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" });
  });

  it("writes a CommonJS config the loader accepts", async () => {
    await writeGreenlyShim(dir);
    const checks = buildChecks(["typescript"], "pnpm");
    const content = renderConfig({ name: "CjsRoundtrip", checks, ext: "cjs", isModule: false });
    await writeFile(join(dir, "greenly.config.cjs"), content);

    const { config } = await loadGreenlyConfig(dir);
    expect(config.name).toBe("CjsRoundtrip");
    expect(config.checks[0]).toMatchObject({ name: "TypeScript", command: "pnpm tsc --noEmit" });
  });

  it("writes an ESM config the loader accepts", async () => {
    await writeGreenlyShim(dir);
    const checks = buildChecks(["oxfmt"], "pnpm");
    const content = renderConfig({ name: "EsmRoundtrip", checks, ext: "mjs", isModule: false });
    await writeFile(join(dir, "greenly.config.mjs"), content);

    const { config } = await loadGreenlyConfig(dir);
    expect(config.name).toBe("EsmRoundtrip");
    expect(config.checks[0]).toMatchObject({ command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" });
  });
});
