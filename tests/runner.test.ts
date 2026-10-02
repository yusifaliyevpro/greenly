import { PassThrough } from "node:stream";
import { type MockInstance, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  execSync: vi.fn<() => void>(),
  spawn: vi.fn<() => void>(),
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn<() => void>(),
  outro: vi.fn<() => void>(),
  cancel: vi.fn<() => void>(),
  confirm: vi.fn<() => void>(),
  isCancel: (v: unknown) => typeof v === "symbol",
  log: {
    step: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
  },
}));

import { ChildProcess, execSync, spawn } from "node:child_process";
import { confirm } from "@clack/prompts";
import { runChecks } from "../src/lib/runner";
import type { GreenlyConfig } from "../src/lib/types";

const mockExec = vi.mocked(execSync);
const mockSpawn = vi.mocked(spawn);
const mockConfirm = vi.mocked(confirm);
let stdoutWrite: MockInstance;
let stderrWrite: MockInstance;

// What Node prints to stderr when oxlint/oxfmt load a TS config in a project without "type": "module".
const NODE_WARNING = [
  "(node:25260) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/proj/oxlint.config.ts?cache=1790963441080 is not specified and it doesn't parse as CommonJS.",
  "Reparsing as ES module because module syntax was detected. This incurs a performance overhead.",
  'To eliminate this warning, add "type": "module" to C:\\proj\\package.json.',
  "(Use `node --trace-warnings ...` to show where the warning was created)",
].join("\n");

/** Fake child process that emits the given output, then exits with `code`. */
function fakeChild(code: number, stdout = "", stderr = ""): ChildProcess {
  const child = new ChildProcess();
  const out = new PassThrough();
  const err = new PassThrough();
  child.stdout = out;
  child.stderr = err;
  setImmediate(() => {
    if (stdout) out.emit("data", Buffer.from(stdout));
    if (stderr) err.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });
  return child;
}

// A command "fails" when its text contains "fail", and prints lint warnings when it contains "warn".
beforeEach(() => {
  vi.clearAllMocks();
  // Silence the runner's own banner/output so it doesn't flood the test report.
  vi.spyOn(console, "log").mockImplementation(() => {});
  stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  mockExec.mockImplementation((cmd: string) => {
    if (cmd.includes("fail")) throw new Error(`command failed: ${cmd}`);
    return Buffer.from("");
  });
  mockSpawn.mockImplementation((cmd: string) => {
    if (cmd.includes("fail")) return fakeChild(1, "", "boom\n");
    if (cmd.includes("stderr-warn")) {
      return fakeChild(0, "Found 0 warnings and 0 errors.\n", `${NODE_WARNING}\nWARN 2 warnings from a dependency\n`);
    }
    if (cmd.includes("warn")) return fakeChild(0, "Found 2 warnings and 0 errors.\n");
    return fakeChild(0, "Found 0 warnings and 0 errors.\n");
  });
});

function config(checks: GreenlyConfig["checks"]): GreenlyConfig {
  return { name: "Test", checks };
}

describe("runChecks", () => {
  it("passes when every command succeeds", async () => {
    const result = await runChecks(config([{ name: "A", command: "ok" }]), { interactive: false });
    expect(result.exitCode).toBe(0);
    expect(result.results[0].status).toBe("passed");
  });

  it("passes when a function command resolves", async () => {
    const fn = vi.fn<() => Promise<void>>(async () => {});
    const result = await runChecks(config([{ name: "A", command: fn }]), { interactive: false });
    expect(fn).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(0);
    expect(result.results[0].status).toBe("passed");
  });

  it("fails when a function command throws", async () => {
    const result = await runChecks(
      config([
        {
          name: "A",
          command: async () => {
            throw new Error("boom");
          },
        },
      ]),
      { interactive: false },
    );
    expect(result.exitCode).toBe(1);
    expect(result.results[0].status).toBe("failed");
  });

  it("does not shell out for a function command", async () => {
    await runChecks(config([{ name: "A", command: () => {} }]), { interactive: false });
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("streams the command's stdout live", async () => {
    await runChecks(config([{ name: "A", command: "warn" }]), { interactive: false });
    expect(stdoutWrite).toHaveBeenCalledWith(Buffer.from("Found 2 warnings and 0 errors.\n"));
  });

  it("reports warnings (not passed) when a passing command prints warnings", async () => {
    const result = await runChecks(config([{ name: "Lint", command: "oxlint warn" }]), { interactive: false });
    expect(result.results[0].status).toBe("warnings");
    expect(result.warnings).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  it("never prints 'All checks passed' when a check has warnings", async () => {
    await runChecks(config([{ name: "Lint", command: "oxlint warn" }]), { interactive: false });
    const logged = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logged).not.toContain("All checks passed");
    expect(logged).toContain("WARNINGS: Lint");
  });

  it("ignores warnings on stderr (Node / package-manager noise)", async () => {
    const result = await runChecks(config([{ name: "Lint", command: "stderr-warn" }]), { interactive: false });
    expect(result.results[0].status).toBe("passed");
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("passes when warnings are ignored for the check", async () => {
    const result = await runChecks(config([{ name: "Lint", command: "oxlint warn", ignoreWarnings: true }]), {
      interactive: false,
    });
    expect(result.results[0].status).toBe("passed");
  });

  it("does not run the fixer for warnings", async () => {
    await runChecks(config([{ name: "Lint", command: "oxlint warn", onFail: "fixup" }]), {
      autoFix: true,
      interactive: false,
    });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("fails a non-optional check with no fixer", async () => {
    const result = await runChecks(config([{ name: "A", command: "fail" }]), { interactive: false });
    expect(result.exitCode).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].status).toBe("failed");
  });

  it("warns (does not fail) an optional check", async () => {
    const result = await runChecks(config([{ name: "A", command: "fail", optional: true }]), {
      interactive: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0].status).toBe("warned");
  });

  it("auto-runs a string fixer with autoFix and marks it fixed", async () => {
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fixup" }]), {
      autoFix: true,
      interactive: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0].status).toBe("fixed");
    expect(mockExec).toHaveBeenCalledWith("fixup", expect.anything());
  });

  it("records failure when the fixer itself fails", async () => {
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fail-fix" }]), {
      autoFix: true,
      interactive: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.results[0].status).toBe("failed");
  });

  it("invokes an onFail function", async () => {
    const fix = vi.fn<() => Promise<void>>(async () => {});
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: fix }]), {
      autoFix: true,
      interactive: false,
    });
    expect(fix).toHaveBeenCalledOnce();
    expect(result.results[0].status).toBe("fixed");
  });

  it("forwards the actual thrown error to an onFail function", async () => {
    const boom = new Error("boom");
    const fix = vi.fn<(ctx: { error: unknown }) => void>();
    await runChecks(
      config([
        {
          name: "A",
          command: () => {
            throw boom;
          },
          onFail: fix,
        },
      ]),
      { autoFix: true, interactive: false },
    );
    expect(fix).toHaveBeenCalledWith(expect.objectContaining({ error: boom }));
  });

  it("prompts in interactive mode and fixes on yes", async () => {
    mockConfirm.mockResolvedValue(true);
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fixup" }]), {
      interactive: true,
    });
    expect(mockConfirm).toHaveBeenCalledOnce();
    expect(result.results[0].status).toBe("fixed");
  });

  it("prompts in interactive mode and skips on no", async () => {
    mockConfirm.mockResolvedValue(false);
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fixup" }]), {
      interactive: true,
    });
    expect(result.results[0].status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });

  it("never prompts when non-interactive", async () => {
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fixup" }]), {
      interactive: false,
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(result.results[0].status).toBe("failed");
  });

  it("does not hang on a non-interactive run with a fixable failure", async () => {
    // A real prompt blocks on stdin. If the runner ever awaited it here, this
    // never-resolving confirm would hang the run and the test would time out.
    mockConfirm.mockReturnValue(new Promise(() => {}));
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fixup" }]), {
      interactive: false,
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
  });

  it("does not hang with --yes even with a fixable failure", async () => {
    mockConfirm.mockReturnValue(new Promise(() => {}));
    const result = await runChecks(config([{ name: "A", command: "fail", onFail: "fixup" }]), {
      autoFix: true,
      interactive: false,
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(result.results[0].status).toBe("fixed");
  });
});
