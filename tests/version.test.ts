import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, compareVersions, fetchLatestVersion, isNewer } from "../src/lib/version";

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.1.2", "1.1.1")).toBe(1);
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.1.1", "1.1.1")).toBe(0);
  });

  it("tolerates a leading v and missing segments", () => {
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.3", "1.2.9")).toBe(1);
  });

  it("sorts a pre-release below the same released core", () => {
    expect(compareVersions("1.2.0", "1.2.0-rc.1")).toBe(1);
    expect(compareVersions("1.2.0-rc.1", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0-rc.2", "1.2.0-rc.1")).toBe(1);
  });
});

describe("isNewer", () => {
  it("is true only when latest is strictly greater", () => {
    expect(isNewer("1.1.0", "1.0.0")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.9.0", "1.0.0")).toBe(false);
  });
});

describe("fetchLatestVersion", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the version from a successful response", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ version: "3.4.5" }), { status: 200 }),
    );
    expect(await fetchLatestVersion("greenly")).toBe("3.4.5");
  });

  it("returns null on a non-ok response", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
    expect(await fetchLatestVersion("greenly")).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(fetchLatestVersion("greenly")).resolves.toBeNull();
  });

  it("returns null when the payload has no version string", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    expect(await fetchLatestVersion("greenly")).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports the update when a newer version exists", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 }),
    );
    expect(await checkForUpdate("greenly", "1.0.0")).toEqual({ current: "1.0.0", latest: "2.0.0" });
  });

  it("returns null when already up to date", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 }),
    );
    expect(await checkForUpdate("greenly", "1.0.0")).toBeNull();
  });

  it("returns null (never rejects) on failure", async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(checkForUpdate("greenly", "1.0.0")).resolves.toBeNull();
  });
});
