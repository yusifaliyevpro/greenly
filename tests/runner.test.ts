import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execSync: vi.fn<() => void>() }));
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

import { execSync } from "node:child_process";
import { confirm } from "@clack/prompts";
import { runChecks } from "../src/lib/runner";
import type { GreenlyConfig } from "../src/lib/types";

const mockExec = vi.mocked(execSync);
const mockConfirm = vi.mocked(confirm);

// A command "fails" when its text contains "fail".
beforeEach(() => {
  vi.clearAllMocks();
  // Silence the runner's own banner/output so it doesn't flood the test report.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  mockExec.mockImplementation((cmd: string) => {
    if (cmd.includes("fail")) throw new Error(`command failed: ${cmd}`);
    return Buffer.from("");
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
