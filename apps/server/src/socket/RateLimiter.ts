// OWNER: Agent 1
// Small fixed-window limiter; one instance per socket and bucket. Game modules apply their own
// finer limits (strokes, guesses); this one is a coarse transport-level guard.
export class RateLimiter {
  private windowStart = 0;
  private count = 0;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if the call is allowed. */
  allow(): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.maxPerWindow;
  }
}
