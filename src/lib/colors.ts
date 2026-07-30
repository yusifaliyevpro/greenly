/**
 * Tiny zero-dependency ANSI color helper. Colors are disabled automatically
 * when `NO_COLOR` is set or stdout is not a TTY.
 */
const enabled = !process.env.NO_COLOR && (process.env.FORCE_COLOR === "1" || (process.stdout?.isTTY ?? false));

function wrap(open: number, close: number) {
  return (text: string): string => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text);
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
