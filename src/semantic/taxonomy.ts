/**
 * Zero-shot categories from embedding anchors. Each category has a few anchor phrases; a token whose embedding is
 * closer to one category's anchors than to the others, and above the margin, gets that category as a tag with a
 * modest weight. Free (no model call beyond the embeddings we already have) and open to edit.
 */
import type { Store } from "../store/db.js";
import type { TokenInfo } from "../analyze/types.js";
import { cosine, type Embedder } from "./provider.js";

export const TAXONOMY: Record<string, string[]> = {
  animal: ["a dog meme coin", "a cat meme coin", "frog toad pepe", "an animal mascot token"],
  stock: ["a tokenized stock ticker", "NVDA TSLA AAPL stock market", "an equity index or ETF"],
  "ai-agent": ["an AI agent token", "grok chatgpt claude assistant", "autonomous bots and agents"],
  politics: ["a political figure meme", "trump election president", "government and politics"],
  "chinese-culture": ["a Chinese internet meme", "red envelope hongbao wealth luck", "china made in china"],
  "crypto-meta": ["bitcoin ethereum solana", "a crypto exchange or chain", "defi launchpad memecoin culture"],
  tool: ["a trading terminal or sniper bot", "a copytrade tool", "developer tooling and infrastructure"],
  celebrity: ["a celebrity or influencer", "elon musk", "a streamer or youtuber"],
  finance: ["get rich quick, 100x, moon", "wealth freedom money", "a bank or payment"],
};
export const CATEGORY_WEIGHT = 0.8;

export async function categoryAnchors(embedder: Embedder): Promise<Map<string, Float32Array[]>> {
  const names = Object.keys(TAXONOMY);
  const texts = names.flatMap((k) => TAXONOMY[k].map((t) => `query: ${t}`));
  const vecs = await embedder.embed(texts);
  const out = new Map<string, Float32Array[]>();
  let i = 0;
  for (const k of names) { out.set(k, vecs.slice(i, i + TAXONOMY[k].length)); i += TAXONOMY[k].length; }
  return out;
}

/** Adds `cat:<name>` tags to tokens with a cached embedding. Returns how many tokens got a category. */
export function applyCategories(store: Store, model: string, anchors: Map<string, Float32Array[]>, tokens: TokenInfo[], margin = 0.02): number {
  const vecs = store.embeddingsFor(tokens.map((t) => t.token), model);
  let n = 0;
  for (const t of tokens) {
    const v = vecs.get(t.token); if (!v) continue;
    let best: [string, number] | null = null, second = -1;
    for (const [name, list] of anchors) {
      let s = -1; for (const a of list) s = Math.max(s, cosine(v, a));
      if (!best || s > best[1]) { if (best) second = Math.max(second, best[1]); best = [name, s]; } else second = Math.max(second, s);
    }
    if (best && best[1] - second >= margin) { t.tags.set(`cat:${best[0]}`, CATEGORY_WEIGHT); n++; }
  }
  return n;
}
