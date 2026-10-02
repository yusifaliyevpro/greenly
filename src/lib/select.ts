import type { GreenlyCheck } from "./types";

/** CLI name of a check: lowercase, with whitespace runs replaced by dashes ("Expo Doctor" -> "expo-doctor"). */
export function checkSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/** CLI names taken by subcommands (`greenly init`), so a check with one can't be selected by name. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["init"]);

/** Checks whose CLI name collides with a subcommand. */
export function reservedChecks(checks: GreenlyCheck[]): GreenlyCheck[] {
  return checks.filter((c) => RESERVED_NAMES.has(checkSlug(c.name)));
}

/**
 * Pick the checks named on the command line, keeping config order. No names
 * selects every check. Names that match no check are returned in `unknown`.
 */
export function selectChecks(
  checks: GreenlyCheck[],
  names: readonly string[],
): { selected: GreenlyCheck[]; unknown: string[] } {
  if (names.length === 0) return { selected: checks, unknown: [] };
  const wanted = new Set(names.map(checkSlug));
  const slugs = new Set(checks.map((c) => checkSlug(c.name)));
  return {
    selected: checks.filter((c) => wanted.has(checkSlug(c.name))),
    unknown: names.filter((n) => !slugs.has(checkSlug(n))),
  };
}
