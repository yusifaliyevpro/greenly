import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGreenlyConfig } from "../src/lib/config";
import {
  buildChecks,
  CHECK_PRESETS,
  configFileName,
  detectPackageManager,
  installCommand,
  renderConfig,
  withCheckScript,
} from "../src/lib/init";
import type { GeneratedCheck } from "../src/lib/init";

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

  it("uses npx for npm and bunx for bun", () => {
    expect(buildChecks(["eslint"], "npm")[0]).toEqual({
      name: "ESLint",
      command: "npx eslint .",
      onFail: "npx eslint . --fix",
    });
    expect(buildChecks(["typescript"], "bun")[0].command).toBe("bunx tsc --noEmit");
  });

  it("uses the run prefix for the build script", () => {
    expect(buildChecks(["build"], "pnpm")[0].command).toBe("pnpm build");
    expect(buildChecks(["build"], "npm")[0].command).toBe("npm run build");
    expect(buildChecks(["build"], "bun")[0].command).toBe("bun run build");
  });

  it("ignores unknown ids", () => {
    expect(buildChecks(["nope"], "pnpm")).toEqual([]);
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
});
