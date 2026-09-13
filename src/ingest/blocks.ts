import type { Gate } from "../chain/rpc.js";
import { PROTOCOL } from "../chain/constants.js";

const hex = (n: number) => "0x" + n.toString(16);

export class BlockClock {
  private cache = new Map<number, number>();
  constructor(private gate: Gate) {}

  async head(): Promise<number> { return Number(BigInt((await this.gate.request("eth_blockNumber")) as string)); }

  async timestamp(block: number): Promise<number> {
    const hit = this.cache.get(block);
    if (hit !== undefined) return hit;
    const b = (await this.gate.request("eth_getBlockByNumber", [hex(block), false])) as { timestamp: string } | null;
    if (!b) throw new Error(`block ${block} not found`);
    const ts = Number(BigInt(b.timestamp));
    this.cache.set(block, ts);
    if (this.cache.size > 5_000) this.cache.delete(this.cache.keys().next().value as number);
    return ts;
  }

  /** Block number at or just before `targetTs`, by measuring the recent block rate and correcting once. */
  async blockAt(targetTs: number, head?: number): Promise<number> {
    const h = head ?? (await this.head());
    const hTs = await this.timestamp(h);
    if (targetTs >= hTs) return h;
    let guess = Math.max(0, h - Math.ceil(((hTs - targetTs) * 1000) / PROTOCOL.approxBlockMs));
    for (let i = 0; i < 3; i++) {
      const gTs = await this.timestamp(guess);
      const probeSpan = Math.max(1, h - guess);
      const rate = (hTs - gTs) / probeSpan; // seconds per block
      const next = Math.max(0, Math.round(guess + (targetTs - gTs) / (rate || 0.1)));
      if (Math.abs(next - guess) < 20) return Math.min(next, h);
      guess = Math.min(next, h);
    }
    return guess;
  }
}
