/** Supported config file extensions, in discovery order (first match wins). */
export const CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs", "json"] as const;

export type ConfigExt = (typeof CONFIG_EXTENSIONS)[number];
