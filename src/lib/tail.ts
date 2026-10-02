/** Default cap for a captured stream: summaries and errors are at the end, so the tail is enough. */
export const MAX_CAPTURE_BYTES = 1024 * 1024;

/** Collects stream chunks but keeps only the last `limit` bytes, so huge output can't grow memory. */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  /** Whether earlier bytes were dropped. */
  truncated = false;

  constructor(private readonly limit: number = MAX_CAPTURE_BYTES) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit) {
      const first = this.chunks[0];
      const excess = this.size - this.limit;
      this.truncated = true;
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.size -= excess;
      }
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
