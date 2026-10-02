import { describe, expect, it } from "vitest";
import { TailBuffer } from "../src/lib/tail";

describe("TailBuffer", () => {
  it("keeps everything under the limit", () => {
    const buf = new TailBuffer(10);
    buf.push(Buffer.from("abc"));
    buf.push(Buffer.from("def"));
    expect(buf.toString()).toBe("abcdef");
    expect(buf.truncated).toBe(false);
  });

  it("keeps only the last `limit` bytes across chunks", () => {
    const buf = new TailBuffer(5);
    buf.push(Buffer.from("abc"));
    buf.push(Buffer.from("defg"));
    buf.push(Buffer.from("hi"));
    expect(buf.toString()).toBe("efghi");
    expect(buf.truncated).toBe(true);
  });

  it("trims a single chunk larger than the limit", () => {
    const buf = new TailBuffer(4);
    buf.push(Buffer.from("0123456789"));
    expect(buf.toString()).toBe("6789");
    expect(buf.truncated).toBe(true);
  });
});
