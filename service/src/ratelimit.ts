/** Token bucket per key: `perMinute` tokens, refilled continuously. Memory only; one process. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private perMinute: number) {}
  allow(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.perMinute, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (this.buckets.size > 50_000) for (const [k, v] of this.buckets) { if (now - v.at > 120_000) this.buckets.delete(k); }
    return true;
  }
}
