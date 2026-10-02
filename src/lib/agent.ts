import { colors } from "./colors";
import { detectPackageManager } from "./utils";

/** Env vars set by AI coding agents (same list oxlint uses for its agent output format). */
const AGENT_ENV_VARS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "COPILOT_CLI",
  "OPENCODE",
  "JUNIE_DATA",
];

/** Whether greenly runs inside an AI agent's terminal (not a normal user terminal or plain CI). */
export function isAgentEnv(env: NodeJS.ProcessEnv): boolean {
  return AGENT_ENV_VARS.some((key) => Boolean(env[key])) || env.TERM_PROGRAM === "kiro";
}

/**
 * The command that re-runs greenly the way it was started: the package.json
 * script when run through one (e.g. "pnpm check"), else the greenly binary.
 */
export function invocation(env: NodeJS.ProcessEnv, lockfiles: readonly string[]): string {
  const pm = detectPackageManager(env.npm_config_user_agent, lockfiles);
  const script = env.npm_lifecycle_event;
  if (script) {
    if (pm === "npm") return `npm run ${script} --`; // npm forwards flags only after `--`
    return pm === "bun" ? `bun run ${script}` : `${pm} ${script}`;
  }
  if (pm === "npm") return "npx greenly";
  return pm === "bun" ? "bunx greenly" : `${pm} greenly`;
}

/** Usage box printed after a run in AI agent terminals. Ends with the flag that hides it, to save context. */
export function agentHints(command: string, slugs: readonly string[]): string {
  const rows: [string, string][] = [
    [`${command} --strict`, "Warned checks (warnings, failed optional checks) also exit 1."],
    [
      `${command} <check_name>...`,
      `Runs only the named checks, as many as needed (e.g. ${command} ${slugs.slice(0, 3).join(" ")}).`,
    ],
    [`${command} --yes`, "Runs onFail fixers without prompting."],
  ];
  const width = Math.max(...rows.map(([cmd]) => cmd.length));
  const bar = colors.dim("│");
  return [
    `${colors.dim("┌")}  ${colors.bold("greenly usage for AI agents")}`,
    ...rows.map(([cmd, text]) => `${bar}  ${colors.cyan(cmd.padEnd(width))}  ${text}`),
    `${bar}  Available check names: ${slugs.join(", ")}`,
    `${bar}  Use ${colors.cyan(`${command} --no-hints`)} to not print this box again.`,
    colors.dim("└"),
  ].join("\n");
}
