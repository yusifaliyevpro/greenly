import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { cancel, confirm, intro, isCancel, log, multiselect, outro, select, spinner, text } from "@clack/prompts";
import { colors } from "./colors";

const execAsync = promisify(exec);

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** Narrow an unknown value to a plain object without an assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Supported config file extensions, in the order shown in the picker. */
export const CONFIG_EXTENSIONS = ["ts", "js", "mjs", "cjs", "mts", "cts", "json"] as const;
export type ConfigExt = (typeof CONFIG_EXTENSIONS)[number];

interface PmContext {
  /** Prefix to run a local binary (e.g. "pnpm", "npx", "bunx"). */
  exec: string;
  /** Prefix to run a package.json script (e.g. "pnpm", "npm run"). */
  run: string;
}

export interface GeneratedCheck {
  name: string;
  command: string;
  onFail?: string;
}

/** A selectable check preset and how to build its command for a package manager. */
export interface CheckPreset {
  value: string;
  label: string;
  build: (ctx: PmContext) => GeneratedCheck;
}

export const CHECK_PRESETS: readonly CheckPreset[] = [
  {
    value: "typescript",
    label: "TypeScript (tsc)",
    build: (c) => ({ name: "TypeScript", command: `${c.exec} tsc --noEmit` }),
  },
  {
    value: "oxlint",
    label: "Oxlint",
    build: (c) => ({ name: "Oxlint", command: `${c.exec} oxlint`, onFail: `${c.exec} oxlint --fix` }),
  },
  {
    value: "eslint",
    label: "ESLint",
    build: (c) => ({ name: "ESLint", command: `${c.exec} eslint .`, onFail: `${c.exec} eslint . --fix` }),
  },
  {
    value: "oxfmt",
    label: "Oxfmt",
    build: (c) => ({ name: "Oxfmt", command: `${c.exec} oxfmt --check`, onFail: `${c.exec} oxfmt` }),
  },
  {
    value: "prettier",
    label: "Prettier",
    build: (c) => ({
      name: "Prettier",
      command: `${c.exec} prettier --check .`,
      onFail: `${c.exec} prettier --write .`,
    }),
  },
  { value: "vitest", label: "Tests (Vitest)", build: (c) => ({ name: "Tests", command: `${c.exec} vitest run` }) },
  { value: "build", label: "Build", build: (c) => ({ name: "Build", command: `${c.run} build` }) },
];

/** Map a package manager to its exec/run prefixes. */
export function pmContext(pm: PackageManager): PmContext {
  switch (pm) {
    case "pnpm":
      return { exec: "pnpm", run: "pnpm" };
    case "yarn":
      return { exec: "yarn", run: "yarn" };
    case "bun":
      return { exec: "bunx", run: "bun run" };
    default:
      return { exec: "npx", run: "npm run" };
  }
}

/** The command that installs greenly for a package manager. */
export function installCommand(pm: PackageManager): string {
  switch (pm) {
    case "pnpm":
      return "pnpm add -D greenly@latest";
    case "yarn":
      return "yarn add -D greenly@latest";
    case "bun":
      return "bun add -d greenly@latest";
    default:
      return "npm install -D greenly@latest";
  }
}

/**
 * Detect the package manager from the invoking agent (npm_config_user_agent),
 * falling back to lockfiles present in the project.
 */
export function detectPackageManager(userAgent: string | undefined, lockfiles: readonly string[]): PackageManager {
  const ua = userAgent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  if (ua.startsWith("npm")) return "npm";

  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) return "bun";
  return "npm";
}

/** Build check objects for the selected preset ids, in catalog order. */
export function buildChecks(selected: readonly string[], pm: PackageManager): GeneratedCheck[] {
  const ctx = pmContext(pm);
  return CHECK_PRESETS.filter((p) => selected.includes(p.value)).map((p) => p.build(ctx));
}

/** The config file name for an extension. */
export function configFileName(ext: ConfigExt): string {
  return `greenly.config.${ext}`;
}

function renderCheck(check: GeneratedCheck): string {
  const parts = [`name: ${JSON.stringify(check.name)}`, `command: ${JSON.stringify(check.command)}`];
  if (check.onFail) parts.push(`onFail: ${JSON.stringify(check.onFail)}`);
  return `{ ${parts.join(", ")} }`;
}

/** Whether the given extension (and package.json type) should emit ESM syntax. */
function isEsm(ext: ConfigExt, isModule: boolean): boolean {
  if (ext === "ts" || ext === "mts" || ext === "mjs") return true;
  if (ext === "cts" || ext === "cjs") return false;
  return isModule; // .js follows package.json "type"
}

/** Render the config file contents for the chosen extension. */
export function renderConfig(opts: {
  name: string;
  checks: GeneratedCheck[];
  ext: ConfigExt;
  isModule: boolean;
}): string {
  const { name, checks, ext, isModule } = opts;

  if (ext === "json") {
    return `${JSON.stringify({ name, checks }, null, 2)}\n`;
  }

  const body = checks.map((c) => `    ${renderCheck(c)},`).join("\n");
  const object = `{\n  name: ${JSON.stringify(name)},\n  checks: [\n${body}\n  ],\n}`;

  if (isEsm(ext, isModule)) {
    return `import { defineConfig } from "greenly";\n\nexport default defineConfig(${object});\n`;
  }
  return `const { defineConfig } = require("greenly");\n\nmodule.exports = defineConfig(${object});\n`;
}

/** Return a copy of the package.json object with the check script set to "greenly". */
export function withCheckScript(pkg: Record<string, unknown>, scriptName: string): Record<string, unknown> {
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  return { ...pkg, scripts: { ...scripts, [scriptName]: "greenly" } };
}

// ── Interactive orchestration ─────────────────────────────────────

function readPackageJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isRecord(parsed)) return parsed;
  } catch {
    // fall through
  }
  return null;
}

function detectLockfiles(cwd: string): string[] {
  return ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb", "bun.lock"].filter((f) =>
    existsSync(join(cwd, f)),
  );
}

/** Exit cleanly if the user cancelled a prompt. */
function ensure<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("init cancelled.");
    process.exit(0);
  }
  return value;
}

/** Interactive `greenly init`: scaffold a config, wire the script, install greenly. */
export async function runInit(cwd: string = process.cwd()): Promise<void> {
  intro(colors.inverse(" greenly ") + colors.dim(" init "));

  const pkgPath = join(cwd, "package.json");
  const pkg = readPackageJson(pkgPath);
  const defaultName = typeof pkg?.name === "string" ? pkg.name : basename(cwd);
  const pm = detectPackageManager(process.env.npm_config_user_agent, detectLockfiles(cwd));

  const name = ensure(
    await text({
      message: "Project name (shown in the banner)",
      placeholder: defaultName,
      defaultValue: defaultName,
    }),
  );

  const ext = ensure(
    await select<ConfigExt>({
      message: "Config file format",
      options: CONFIG_EXTENSIONS.map((e) => ({ value: e, label: configFileName(e) })),
      initialValue: "ts",
    }),
  );

  const scriptName = ensure(
    await text({
      message: "Script name to add to package.json",
      placeholder: "check",
      defaultValue: "check",
    }),
  );

  const selected = ensure(
    await multiselect({
      message: "Select the checks to include",
      options: CHECK_PRESETS.map((p) => ({ value: p.value, label: p.label })),
      required: true,
    }),
  );

  const doInstall = ensure(await confirm({ message: `Install greenly now with ${pm}?`, initialValue: true }));

  // Write the config file.
  const fileName = configFileName(ext);
  const filePath = join(cwd, fileName);
  if (existsSync(filePath)) {
    const overwrite = ensure(
      await confirm({ message: `${fileName} already exists. Overwrite it?`, initialValue: false }),
    );
    if (!overwrite) {
      cancel("Kept the existing config. Nothing changed.");
      process.exit(0);
    }
  }
  const checks = buildChecks(selected, pm);
  const content = renderConfig({ name, checks, ext, isModule: pkg?.type === "module" });
  writeFileSync(filePath, content);
  log.success(`Created ${colors.bold(fileName)}`);

  // Wire the package.json script.
  if (pkg) {
    const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
    const current = scripts[scriptName];
    let write = true;
    if (typeof current === "string" && current !== "greenly") {
      write = ensure(
        await confirm({
          message: `Script "${scriptName}" already runs "${current}". Overwrite with "greenly"?`,
          initialValue: false,
        }),
      );
    }
    if (write) {
      writeFileSync(pkgPath, `${JSON.stringify(withCheckScript(pkg, scriptName), null, 2)}\n`);
      log.success(`Added ${colors.bold(`"${scriptName}": "greenly"`)} to package.json`);
    }
  } else {
    log.warn("No package.json found, skipped adding the script.");
  }

  // Install greenly.
  if (doInstall) {
    const s = spinner();
    s.start(`Installing greenly with ${pm}`);
    try {
      await execAsync(installCommand(pm), { cwd });
      s.stop("Installed greenly");
    } catch {
      s.stop("Could not install greenly automatically");
      log.warn(`Run "${installCommand(pm)}" yourself.`);
    }
  } else {
    log.info(`Skipped install. Run "${installCommand(pm)}" when ready.`);
  }

  const runCmd = `${pmContext(pm).run} ${scriptName}`;
  outro(`Done. Run ${colors.bold(runCmd)} to run your checks.`);
}
