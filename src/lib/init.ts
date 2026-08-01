import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { cancel, confirm, intro, isCancel, log, multiselect, outro, select, spinner, text } from "@clack/prompts";
import { colors } from "./colors";
import { CONFIG_EXTENSIONS } from "./constants";
import type { ConfigExt } from "./constants";
import { detectLockfiles, detectPackageManager, installCommand } from "./utils";
import type { PackageManager } from "./utils";
import { fetchLatestVersion, isNewer } from "./version";

const execAsync = promisify(exec);

/** Narrow an unknown value to a plain object without an assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PmContext = {
  /** Prefix to run a local binary (e.g. "pnpm", "npx", "bunx"). */
  exec: string;
  /** Prefix to run a package.json script (e.g. "pnpm", "npm run"). */
  run: string;
};

/** Context passed to a preset when building its check command. */
type BuildContext = PmContext & {
  /** Installed dependency names, so a preset can tweak its command (e.g. tsc for Next.js). */
  deps: ReadonlySet<string>;
  /** Script names present in package.json, preferred over raw tool commands. */
  scripts: ReadonlySet<string>;
};

/** If package.json already defines a matching script, run that (via the run prefix). */
function scriptCommand(ctx: BuildContext, candidates: readonly string[]): string | null {
  const found = candidates.find((s) => ctx.scripts.has(s));
  return found ? `${ctx.run} ${found}` : null;
}

export type GeneratedCheck = {
  name: string;
  command: string;
  onFail?: string;
};

/**
 * A selectable check preset and how to build its command for a package manager.
 *
 * To add a new built-in check (e.g. expo-doctor, a custom doctor script), append
 * an entry here. Set `detect` to the dependency (or dependencies) that gate it:
 * the preset is only offered when `detect` returns true for the installed deps.
 * Presets with no `detect` are always offered (e.g. Build, which is generic).
 */
export type CheckPreset = {
  value: string;
  label: string;
  /**
   * Whether to offer this preset, given the set of installed dependency names
   * (dependencies + devDependencies). Omit to always offer it.
   */
  detect?: (deps: ReadonlySet<string>) => boolean;
  build: (ctx: BuildContext) => GeneratedCheck;
};

/** A preset gated on a single dependency being present in package.json. */
const dep = (name: string) => (deps: ReadonlySet<string>) => deps.has(name);

export const CHECK_PRESETS: readonly CheckPreset[] = [
  {
    value: "typescript",
    label: "TypeScript (tsc)",
    detect: dep("typescript"),
    // Next.js sets `incremental: true` in tsconfig, so `tsc --noEmit` needs `--incremental false`.
    build: (c) => ({
      name: "TypeScript",
      command:
        scriptCommand(c, ["typecheck", "type-check"]) ??
        `${c.run} tsc --noEmit${dep("next")(c.deps) ? " --incremental false" : ""}`,
    }),
  },
  // Formatters come before linters so a fix reformats before linting runs.
  {
    value: "oxfmt",
    label: "Oxfmt",
    detect: dep("oxfmt"),
    build: (c) => ({
      name: "Oxfmt",
      command: scriptCommand(c, ["fmt:check", "format:check"]) ?? `${c.run} oxfmt --check`,
      onFail: scriptCommand(c, ["fmt", "format"]) ?? `${c.run} oxfmt`,
    }),
  },
  {
    value: "prettier",
    label: "Prettier",
    detect: dep("prettier"),
    build: (c) => ({
      name: "Prettier",
      command: scriptCommand(c, ["fmt:check", "format:check"]) ?? `${c.run} prettier --check .`,
      onFail: scriptCommand(c, ["fmt", "format"]) ?? `${c.run} prettier --write .`,
    }),
  },
  {
    value: "oxlint",
    label: "Oxlint",
    detect: dep("oxlint"),
    build: (c) => ({
      name: "Oxlint",
      command: scriptCommand(c, ["lint"]) ?? `${c.run} oxlint`,
    }),
  },
  {
    value: "eslint",
    label: "ESLint",
    detect: dep("eslint"),
    build: (c) => ({
      name: "ESLint",
      command: scriptCommand(c, ["lint"]) ?? `${c.run} eslint .`,
    }),
  },
  {
    value: "vitest",
    label: "Tests (Vitest)",
    detect: dep("vitest"),
    build: (c) => ({ name: "Tests", command: scriptCommand(c, ["test"]) ?? `${c.run} vitest run` }),
  },
  {
    value: "expo-doctor",
    label: "Expo Doctor",
    detect: dep("expo"),
    build: (c) => ({ name: "Expo Doctor", command: scriptCommand(c, ["doctor"]) ?? `${c.exec} expo-doctor` }),
  },
  {
    value: "build",
    label: "Build",
    build: (c) => ({ name: "Build", command: scriptCommand(c, ["build"]) ?? `${c.run} build` }),
  },
  {
    value: "react-doctor",
    label: "React Doctor",
    detect: dep("react"),
    build: (c) => ({ name: "React Doctor", command: `${c.exec} react-doctor --verbose` }),
  },
];

/** Map a package manager to its exec/run prefixes. */
export function pmContext(pm: PackageManager): PmContext {
  switch (pm) {
    case "pnpm":
      return { exec: "pnpx", run: "pnpm" };
    case "yarn":
      return { exec: "yarn dlx", run: "yarn" };
    case "bun":
      return { exec: "bunx", run: "bun run" };
    default:
      return { exec: "npx", run: "npm run" };
  }
}

/** Build check objects for the selected preset ids, in catalog order. */
export function buildChecks(
  selected: readonly string[],
  pm: PackageManager,
  opts: { deps?: ReadonlySet<string>; scripts?: ReadonlySet<string> } = {},
): GeneratedCheck[] {
  const ctx: BuildContext = {
    ...pmContext(pm),
    deps: opts.deps ?? new Set(),
    scripts: opts.scripts ?? new Set(),
  };
  return CHECK_PRESETS.filter((p) => selected.includes(p.value)).map((p) => p.build(ctx));
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

/** Where greenly is declared in package.json: a devDependency, a (prod) dependency, or absent. */
export type GreenlyLocation = "dev" | "prod" | "none";

/** Which dependency list greenly is declared in (devDependencies wins if it is in both). */
export function greenlyLocation(pkg: Record<string, unknown> | null): GreenlyLocation {
  const inField = (field: string) => {
    const deps = pkg?.[field];
    return isRecord(deps) && "greenly" in deps;
  };
  if (inField("devDependencies")) return "dev";
  if (inField("dependencies")) return "prod";
  return "none";
}

/** The greenly version range declared in the root package.json (devDependencies preferred), or null. */
export function declaredGreenlyVersion(pkg: Record<string, unknown> | null): string | null {
  for (const field of ["devDependencies", "dependencies"]) {
    const deps = pkg?.[field];
    if (isRecord(deps) && typeof deps.greenly === "string") return deps.greenly;
  }
  return null;
}

/**
 * Whether `init` should offer to install greenly. It skips the install step
 * only when greenly is already a devDependency at the latest version (per the
 * version declared in the root package.json); a missing entry, a
 * prod-`dependencies` placement, or an outdated/undeterminable version all fall
 * through to offering it.
 */
export function shouldOfferInstall(opts: {
  location: GreenlyLocation;
  declaredVersion: string | null;
  latestVersion: string | null;
}): boolean {
  const { location, declaredVersion, latestVersion } = opts;
  if (location === "dev" && declaredVersion && latestVersion && !isNewer(latestVersion, declaredVersion)) {
    return false;
  }
  return true;
}

/**
 * Presets to offer given the installed dependencies. Each preset is gated
 * independently on its own `detect` predicate (typically the presence of a
 * single dependency in package.json). Presets without a `detect` are always
 * offered (e.g. Build).
 */
export function availablePresets(installed: ReadonlySet<string>): CheckPreset[] {
  return CHECK_PRESETS.filter((p) => !p.detect || p.detect(installed));
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
  // Kick off the npm latest-version lookup now so it overlaps with the prompts.
  const latestPromise = fetchLatestVersion("greenly");

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

  const installed = installedDependencies(pkg);
  const presets = availablePresets(installed);
  const selected = ensure(
    await multiselect({
      message: "Select the checks to include",
      options: presets.map((p) => ({ value: p.value, label: p.label })),
      required: true,
    }),
  );

  // Offer to install unless greenly is already a devDependency at the latest version.
  const declaredVersion = declaredGreenlyVersion(pkg);
  const latestVersion = await latestPromise;
  const alreadyLatest = !shouldOfferInstall({
    location: greenlyLocation(pkg),
    declaredVersion,
    latestVersion,
  });
  const doInstall = alreadyLatest
    ? false
    : ensure(await confirm({ message: `Install greenly now with ${pm}?`, initialValue: true }));

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
  const checks = buildChecks(selected, pm, { deps: installed, scripts: packageScripts(pkg) });
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
  } else if (alreadyLatest) {
    log.info(`greenly ${colors.bold(declaredVersion ?? "")} already a devDependency at latest, skipped install.`);
  } else {
    log.info(`Skipped install. Run "${installCommand(pm)}" when ready.`);
  }

  const runCmd = `${pmContext(pm).run} ${scriptName}`;
  outro(`Done. Run ${colors.bold(runCmd)} to run your checks.`);
}
