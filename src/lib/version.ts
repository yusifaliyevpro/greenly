/**
 * Version comparison and a best-effort npm "is there a newer version" check.
 *
 * Everything here is defensive: the update check is an aside that must never
 * throw, never log, and never block the CLI. On any failure (offline, npm down,
 * bad JSON, timeout) the helpers resolve to `null` and the caller stays silent.
 */
const parse = (v: string) => {
  // Strip a leading range operator (^, ~, >=, etc.) or `v` so a package.json
  // range like "^1.2.0" compares by its version core.
  const [core = "", pre = ""] = v
    .trim()
    .replace(/^[v^~>=< ]+/, "")
    .split("-", 2);
  const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return { nums, pre };
};

/**
 * Compare two dotted version strings. Returns 1 if `a > b`, -1 if `a < b`, 0 if
 * equal. A leading range operator (`^`, `~`, `>=`, `v`) is ignored. Compares the
 * numeric major.minor.patch core; a version with a pre-release suffix (e.g.
 * `1.2.0-rc.1`) sorts below the same core without one.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1; // 1.2.0 > 1.2.0-rc.1
  if (pb.pre === "") return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

/** Whether `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** An available update: the version in use and the newer one on npm. */
export type UpdateInfo = {
  current: string;
  latest: string;
};

/**
 * Fetch the `latest` dist-tag version of a package from the npm registry.
 * Resolves to the version string, or `null` on any failure. Never throws.
 */
export async function fetchLatestVersion(pkg: string, timeoutMs = 3000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
        signal: controller.signal,
        // Abbreviated metadata: smaller payload than the full packument.
        headers: { accept: "application/vnd.npm.install-v1+json" },
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (data && typeof data === "object" && "version" in data) {
        const version = (data as { version?: unknown }).version;
        return typeof version === "string" ? version : null;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null; // offline, npm down, aborted, bad JSON: stay silent.
  }
}

/**
 * Non-blocking check for a newer version. Resolves to the update info when a
 * newer version exists, or `null` otherwise (including on any failure). Never
 * rejects, so it is safe to start and `await` later without a try/catch.
 */
export async function checkForUpdate(pkg: string, current: string): Promise<UpdateInfo | null> {
  const latest = await fetchLatestVersion(pkg);
  if (latest && isNewer(latest, current)) return { current, latest };
  return null;
}
