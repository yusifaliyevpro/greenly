import { stripVTControlCharacters } from "node:util";

/** Warning markers printed by common linters (oxlint in every format, ESLint, GitHub annotations). */
const WARNING_PATTERNS = [
  /\b[1-9]\d* warnings? and \d+ errors?\b/i, // "Found 2 warnings and 0 errors."
  /\b\d+ errors?, [1-9]\d* warnings?\)/i, // "(0 errors, 2 warnings)"
  /:\d+:\d+: warning\b/, // "a.js:2:7: warning eslint(...)"
  /\[Warning\//, // "[Warning/eslint(no-debugger)]"
  /^::warning\b/m, // GitHub annotations
];

/** Whether a command's output reports warnings, even though it exited 0. */
export function hasWarnings(output: string): boolean {
  const plain = stripVTControlCharacters(output);
  return WARNING_PATTERNS.some((pattern) => pattern.test(plain));
}
