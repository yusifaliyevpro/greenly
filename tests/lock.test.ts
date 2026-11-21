import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, isAlive } from "../src/lib/lock";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "greenly-lock-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("acquireLock", () => {
  it("writes our pid and removes the lock on release", async () => {
    const release = await acquireLock(dir, () => {});
    expect(readFileSync(join(dir, "lock"), "utf8")).toBe(String(process.pid));
    release();
    expect(existsSync(join(dir, "lock"))).toBe(false);
  });

  it("takes over a lock left by a dead process", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lock"), "999999999");
    const onWait = vi.fn<(pid: number) => void>();
    const release = await acquireLock(dir, onWait);
    expect(onWait).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, "lock"), "utf8")).toBe(String(process.pid));
    release();
  });

  it("waits while a live process holds the lock", async () => {
    // The parent process (vitest's runner) is alive and isn't us.
    writeFileSync(join(dir, "lock"), String(process.ppid));
    const onWait = vi.fn<(pid: number) => void>();
    const pending = acquireLock(dir, onWait, 10);
    await new Promise((r) => setTimeout(r, 50));
    expect(onWait).toHaveBeenCalledWith(process.ppid);
    rmSync(join(dir, "lock"));
    const release = await pending;
    expect(readFileSync(join(dir, "lock"), "utf8")).toBe(String(process.pid));
    release();
  });
});

describe("isAlive", () => {
  it("detects the current process", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(999999999)).toBe(false);
  });
});
