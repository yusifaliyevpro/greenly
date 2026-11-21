import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}

/** Whether a process with this pid is running (EPERM means it exists but isn't ours). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/** Pid stored in the lock file, or `undefined` when missing or unreadable. */
function lockOwner(path: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8"), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return Infinity;
  }
}

/**
 * Take `<dir>/lock` so only one greenly runs checks per project at a time.
 * Waits while another live run holds it (`onWait` is called once with its pid);
 * a lock left by a dead process is taken over. Returns the release function.
 */
export async function acquireLock(dir: string, onWait: (pid: number) => void, pollMs = 500): Promise<() => void> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "lock");
  let waited = false;

  while (true) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return () => {};
    }
    const owner = lockOwner(path);
    // No pid yet may mean the owner is mid-write, so an empty lock is stale only once it's old.
    const stale = owner === undefined ? ageMs(path) > 5000 : owner === process.pid || !isAlive(owner);
    if (stale) {
      rmSync(path, { force: true });
      continue;
    }
    if (!waited && owner !== undefined) {
      onWait(owner);
      waited = true;
    }
    await sleep(pollMs);
  }

  const release = () => {
    if (lockOwner(path) === process.pid) rmSync(path, { force: true });
  };
  process.once("exit", release);
  return release;
}
