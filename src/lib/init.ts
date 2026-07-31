import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { cancel, confirm, intro, isCancel, log, multiselect, outro, select, spinner, text } from "@clack/prompts";
import { colors } from "./colors";
import { CONFIG_EXTENSIONS } from "./constants";
import type { ConfigExt } from "./constants";

const execAsync = promisify(exec);

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** Narrow an unknown value to a plain object without an assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface PmContext {
  /** Prefix to run a local binary (e.g. "pnpm", "npx", "bunx"). */
  exec: string;
  /** Prefix to run a package.json script (e.g. "pnpm", "npm run"). */
  run: string;
}

/** Context passed to a preset when building its check command. */
interface BuildContext extends PmContext {
  /** Whether the project is Next.js (adds `--incremental false` to tsc). */
  isNext: boolean;
  /** Script names present in package.json, preferred over raw tool commands. */
  scripts: ReadonlySet<string>;
}

/** If package.json already defines a matching script, run that (via the run prefix). */
function scriptCommand(ctx: BuildContext, candidates: readonly string[]): string | null {
  const found = candidates.find((s) => ctx.scripts.has(s));
  return found ? `${ctx.run} ${found}` : null;
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
  build: (ctx: BuildContext) => GeneratedCheck;
}

export const CHECK_PRESETS: readonly CheckPreset[] = [
  {
    value: "typescript",
    label: "TypeScript (tsc)",
    // Next.js sets `incremental: true` in tsconfig, so `tsc --noEmit` needs `--incremental false`.
    build: (c) => ({
      name: "TypeScript",
      command:
        scriptCommand(c, ["typecheck", "type-check"]) ??
        `${c.exec} tsc --noEmit${c.isNext ? " --incremental false" : ""}`,
    }),
  },
  // Formatters come before linters so a fix reformats before linting runs.
  {
    value: "oxfmt",
    label: "Oxfmt",
    build: (c) => ({
      name: "Oxfmt",
      command: scriptCommand(c, ["fmt:check", "format:check"]) ?? `${c.exec} oxfmt --check`,
      onFail: scriptCommand(c, ["fmt", "format"]) ?? `${c.exec} oxfmt`,
    }),
  },
  {
    value: "prettier",
    label: "Prettier",
    build: (c) => ({
      name: "Prettier",
      command: scriptCommand(c, ["fmt:check", "format:check"]) ?? `${c.exec} prettier --check .`,
      onFail: scriptCommand(c, ["fmt", "format"]) ?? `${c.exec} prettier --write .`,
    }),
  },
  {
    value: "oxlint",
    label: "Oxlint",
    build: (c) => ({
      name: "Oxlint",
      command: scriptCommand(c, ["lint"]) ?? `${c.exec} oxlint`,
    }),
  },
  {
    value: "eslint",
    label: "ESLint",
    build: (c) => ({
      name: "ESLint",
      command: scriptCommand(c, ["lint"]) ?? `${c.exec} eslint .`,
    }),
  },
  {
    value: "vitest",
    label: "Tests (Vitest)",
    build: (c) => ({ name: "Tests", command: scriptCommand(c, ["test"]) ?? `${c.exec} vitest run` }),
  },
  {
    value: "build",
    label: "Build",
    build: (c) => ({ name: "Build", command: scriptCommand(c, ["build"]) ?? `${c.run} build` }),
  },
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
export function buildChecks(
  selected: readonly string[],
  pm: PackageManager,
  opts: { isNext?: boolean; scripts?: ReadonlySet<string> } = {},
): GeneratedCheck[] {
  const ctx: BuildContext = {
    ...pmContext(pm),
    isNext: opts.isNext ?? false,
    scripts: opts.scripts ?? new Set(),
  };
  return CHECK_PRESETS.filter((p) => selected.includes(p.value)).map((p) => p.build(ctx));
}

/** Whether the project is a Next.js app (has a next.config file, or `next` as a dependency). */
export function isNextProject(pkg: Record<string, unknown> | null, hasNextConfig: boolean): boolean {
  if (hasNextConfig) return true;
  const hasNextDep = (field: string) => {
    const deps = pkg?.[field];
    return isRecord(deps) && "next" in deps;
  };
  return hasNextDep("dependencies") || hasNextDep("devDependencies");
}

/** Script names declared in package.json. */
export function packageScripts(pkg: Record<string, unknown> | null): Set<string> {
  const scripts = pkg?.scripts;
  return isRecord(scripts) ? new Set(Object.keys(scripts)) : new Set();
}

/** All dependency names declared in package.json (dependencies + devDependencies). */
export function installedDependencies(pkg: Record<string, unknown> | null): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg?.[field];
    if (isRecord(deps)) for (const key of Object.keys(deps)) names.add(key);
  }
  return names;
}

/**
 * Presets to offer given the installed dependencies. For a competing pair
 * (Oxlint/ESLint, Oxfmt/Prettier), when exactly one is installed only that one
 * is shown; when both or neither are present, both are shown.
 */
export function availablePresets(installed: ReadonlySet<string>): CheckPreset[] {
  const hidden = new Set<string>();
  const prefer = (a: string, b: string) => {
    if (installed.has(a) && !installed.has(b)) hidden.add(b);
    if (installed.has(b) && !installed.has(a)) hidden.add(a);
  };
  prefer("oxlint", "eslint");
  prefer("oxfmt", "prettier");
  return CHECK_PRESETS.filter((p) => !hidden.has(p.value));
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

function hasNextConfigFile(cwd: string): boolean {
  return ["js", "mjs", "cjs", "ts", "mts", "cts"].some((e) => existsSync(join(cwd, `next.config.${e}`)));
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
      initialValue: defaultName,
      validate: (value) => (value?.trim() ? undefined : "Please enter a project name"),
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
      initialValue: "check",
      validate: (value) => (value?.trim() ? undefined : "Please enter a script name"),
    }),
  );

  const presets = availablePresets(installedDependencies(pkg));
  const selected = ensure(
    await multiselect({
      message: "Select the checks to include",
      options: presets.map((p) => ({ value: p.value, label: p.label })),
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
  const isNext = isNextProject(pkg, hasNextConfigFile(cwd));
  if (isNext && selected.includes("typescript")) {
    log.info(colors.dim("Detected Next.js, using tsc --incremental false"));
  }
  const checks = buildChecks(selected, pm, { isNext, scripts: packageScripts(pkg) });
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
