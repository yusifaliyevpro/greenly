import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { agentHints, invocation, isAgentEnv } from "../src/lib/agent";

describe("isAgentEnv", () => {
  it("detects AI agent terminals", () => {
    for (const key of ["AI_AGENT", "CLAUDECODE", "CURSOR_AGENT", "GEMINI_CLI", "CODEX_SANDBOX", "OPENCODE"]) {
      expect(isAgentEnv({ [key]: "1" })).toBe(true);
    }
    expect(isAgentEnv({ TERM_PROGRAM: "kiro" })).toBe(true);
  });

  it("is false in a normal terminal or plain CI", () => {
    expect(isAgentEnv({})).toBe(false);
    expect(isAgentEnv({ CI: "true", TERM_PROGRAM: "vscode" })).toBe(false);
    expect(isAgentEnv({ CLAUDECODE: "" })).toBe(false);
  });
});

describe("invocation", () => {
  it("uses the package.json script when run through one", () => {
    expect(invocation({ npm_lifecycle_event: "check", npm_config_user_agent: "pnpm/11.0.0" }, [])).toBe("pnpm check");
    expect(invocation({ npm_lifecycle_event: "check", npm_config_user_agent: "yarn/4.0.0" }, [])).toBe("yarn check");
    expect(invocation({ npm_lifecycle_event: "check", npm_config_user_agent: "bun/1.2.0" }, [])).toBe("bun run check");
    // npm only forwards flags to the script after `--`.
    expect(invocation({ npm_lifecycle_event: "check", npm_config_user_agent: "npm/11.0.0" }, [])).toBe(
      "npm run check --",
    );
  });

  it("runs the greenly binary when called directly", () => {
    expect(invocation({ npm_config_user_agent: "pnpm/11.0.0" }, [])).toBe("pnpm greenly");
    expect(invocation({}, ["yarn.lock"])).toBe("yarn greenly");
    expect(invocation({}, ["bun.lock"])).toBe("bunx greenly");
    expect(invocation({}, [])).toBe("npx greenly");
  });
});

describe("agentHints", () => {
  it("lists strict, subset, fix and no-hints usage plus the check names", () => {
    const text = stripVTControlCharacters(agentHints("pnpm check", ["typescript", "oxlint", "tests"]));
    expect(text).toContain("pnpm check --strict");
    expect(text).toContain("pnpm check <check_name>...");
    expect(text).toContain("e.g. pnpm check typescript oxlint tests");
    expect(text).toContain("pnpm check --yes");
    expect(text).toContain("Available check names: typescript, oxlint, tests");
    // The last line names the flag that hides the box, so agents can skip it on later runs.
    expect(text.trimEnd().split("\n").at(-2)).toContain("pnpm check --no-hints");
    expect(text).not.toMatch(/\b(should|must|please)\b/i);
  });
});
