import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_EXTENSIONS,
  ConfigInvalidError,
  ConfigNotFoundError,
  findConfigFile,
  loadGreenlyConfig,
} from "../src/lib/config";

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
