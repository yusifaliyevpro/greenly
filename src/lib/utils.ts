import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** The command that installs (or updates to) the latest greenly for a package manager. */
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

/** Lockfiles present in a directory, in package-manager precedence order. */
export function detectLockfiles(cwd: string): string[] {
  return ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb", "bun.lock"].filter((f) =>
    existsSync(join(cwd, f)),
  );
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
