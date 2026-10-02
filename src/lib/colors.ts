/**
 * Tiny zero-dependency ANSI color helper. Colors follow the TTY unless
 * overridden by `NO_COLOR` (off) or `FORCE_COLOR` (on, or off when `0`/`false`).
 */
export function shouldUseColor(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env.NO_COLOR) return false;
  const force = env.FORCE_COLOR;
  if (force === undefined) return isTTY;
  return force !== "0" && force !== "false";
}

export const colorsEnabled = shouldUseColor(process.env, process.stdout?.isTTY ?? false);

function wrap(open: number, close: number) {
  return (text: string): string => (colorsEnabled ? `\x1b[${open}m${text}\x1b[${close}m` : text);
}

export const colors = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  inverse: wrap(7, 27),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
};
