import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigInvalidError, ConfigNotFoundError, findConfigFile, loadGreenlyConfig } from "../src/lib/config";
import { CONFIG_EXTENSIONS } from "../src/lib/constants";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "greenly-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Fixtures use a plain default export (equivalent to defineConfig, which is
// identity) so the loader test doesn't depend on resolving the "greenly" import.
const objConfig = `export default { name: "Proj", checks: [{ name: "echo", command: "echo hi" }] };`;
const cjsConfig = `module.exports = { name: "Proj", checks: [{ name: "echo", command: "echo hi" }] };`;
const jsonConfig = JSON.stringify({ name: "Proj", checks: [{ name: "echo", command: "echo hi" }] });

function fixtureFor(ext: string): string {
  if (ext === "json") return jsonConfig;
  if (ext === "cjs" || ext === "cts") return cjsConfig;
  return objConfig;
}

describe("findConfigFile", () => {
  it("returns undefined when no config exists", () => {
    expect(findConfigFile(dir)).toBeUndefined();
  });

  it("finds a config file", async () => {
    await writeFile(join(dir, "greenly.config.ts"), objConfig);
    expect(findConfigFile(dir)).toBe(join(dir, "greenly.config.ts"));
  });
});

describe("findConfigFile in parent folders", () => {
  it("finds the nearest config in a parent folder", async () => {
    const nested = join(dir, "packages", "web");
    await mkdir(nested, { recursive: true });
    await writeFile(join(dir, "greenly.config.ts"), objConfig);
    expect(findConfigFile(nested)).toBe(join(dir, "greenly.config.ts"));
  });

  it("prefers the closest config", async () => {
    const nested = join(dir, "packages", "web");
    await mkdir(nested, { recursive: true });
    await writeFile(join(dir, "greenly.config.ts"), objConfig);
    await writeFile(join(dir, "packages", "greenly.config.json"), jsonConfig);
    expect(findConfigFile(nested)).toBe(join(dir, "packages", "greenly.config.json"));
  });

  it("stops at the repository root (.git)", async () => {
    const repo = join(dir, "repo");
    const nested = join(repo, "src");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(dir, "greenly.config.ts"), objConfig);
    expect(findConfigFile(nested)).toBeUndefined();
  });

  it("loads a parent config and names it after the config folder's package.json", async () => {
    const nested = join(dir, "packages", "web");
    await mkdir(nested, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "monorepo" }));
    await writeFile(join(dir, "greenly.config.json"), JSON.stringify({ checks: [{ name: "a", command: "x" }] }));
    const { config, configFile } = await loadGreenlyConfig(nested);
    expect(configFile).toBe(join(dir, "greenly.config.json"));
    expect(config.name).toBe("monorepo");
  });
});

describe("loadGreenlyConfig", () => {
  for (const ext of CONFIG_EXTENSIONS) {
    it(`loads greenly.config.${ext}`, async () => {
      await writeFile(join(dir, `greenly.config.${ext}`), fixtureFor(ext));
      const { config, configFile } = await loadGreenlyConfig(dir);
      expect(configFile).toBe(join(dir, `greenly.config.${ext}`));
      expect(config.name).toBe("Proj");
      expect(config.checks).toHaveLength(1);
      expect(config.checks[0]).toMatchObject({ name: "echo", command: "echo hi" });
    });
  }

  it("defaults name to the package.json name", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "my-pkg" }));
    await writeFile(join(dir, "greenly.config.json"), JSON.stringify({ checks: [{ name: "a", command: "x" }] }));
    expect((await loadGreenlyConfig(dir)).config.name).toBe("my-pkg");
  });

  it("defaults name to the directory name without a package.json name", async () => {
    await writeFile(join(dir, "package.json"), "{}");
    await writeFile(join(dir, "greenly.config.json"), JSON.stringify({ checks: [{ name: "a", command: "x" }] }));
    expect((await loadGreenlyConfig(dir)).config.name).toBe(basename(dir));
  });

  it("throws ConfigNotFoundError when missing", async () => {
    await expect(loadGreenlyConfig(dir)).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it("throws ConfigInvalidError when checks is empty", async () => {
    await writeFile(join(dir, "greenly.config.ts"), `export default { checks: [] };`);
    await expect(loadGreenlyConfig(dir)).rejects.toBeInstanceOf(ConfigInvalidError);
  });

  it("throws ConfigInvalidError when a check is malformed", async () => {
    await writeFile(join(dir, "greenly.config.ts"), `export default { checks: [{ name: "x" }] };`);
    await expect(loadGreenlyConfig(dir)).rejects.toBeInstanceOf(ConfigInvalidError);
  });
});
