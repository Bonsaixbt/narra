/**
 * Narrative = the class a cluster belongs to, decided by rules anyone can read in dictionary.json.
 * Chinese names are a narrative of their own on this chain (half the metas some hours), so CJK is checked first;
 * the strongest tag family becomes the sub-narrative ("chinese · animals").
 */
import dictionary from "./dictionary.json" with { type: "json" };
import type { TokenInfo } from "./types.js";

const RULES: [string, Set<string>][] = Object.entries(dictionary.narratives as Record<string, string[] | string>)
  .filter(([k, v]) => !k.startsWith("_") && Array.isArray(v))
  .map(([k, v]) => [k, new Set(v as string[])]);

export const NARRATIVES = ["chinese", ...RULES.map(([k]) => k), "mixed"] as const;
/** Semantic categories (taxonomy.ts) vote for the dictionary family they mean, so a "stock" category and a "stocks" tag add up. */
const CATEGORY_FAMILY: Record<string, string> = { animal: "animals", stock: "stocks", "ai-agent": "ai-agents", politics: "politics", "chinese-culture": "chinese", "crypto-meta": "crypto", tool: "tools", celebrity: "celebrities", finance: "money" };
export type Narrative = string;

export interface NarrativeResult { narrative: Narrative; sub: Narrative | null; mix: Record<string, number>; cjk_share: number }

const hasCJK = (s: string) => /[一-鿿぀-ヿ가-힯]/.test(s);

/** minShare: a family names the cluster when its votes cover this share of members; 0.25 after a week of boards (0.3 left a third of live metas "mixed" with a leader at 0.27). */
export function narrativeOf(members: TokenInfo[], minShare = 0.25): NarrativeResult {
  if (!members.length) return { narrative: "mixed", sub: null, mix: {}, cjk_share: 0 };
  const votes = new Map<string, number>();
  let cjk = 0;
  for (const m of members) {
    if (hasCJK(m.name) || hasCJK(m.symbol)) cjk++;
    const seen = new Set<string>();
    for (const [tag, w] of m.tags) {
      if (tag.startsWith("cat:")) { const n = CATEGORY_FAMILY[tag.slice(4)] ?? tag.slice(4); votes.set(n, (votes.get(n) ?? 0) + 0.5 * w); continue; }
      for (const [name, set] of RULES) if (set.has(tag) && !seen.has(name)) { seen.add(name); votes.set(name, (votes.get(name) ?? 0) + Math.min(1.2, w)); }
    }
  }
  const mix: Record<string, number> = {};
  for (const [k, v] of votes) mix[k] = Math.round((v / members.length) * 100) / 100;
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const top = ranked[0] && ranked[0][1] / members.length >= minShare ? ranked[0][0] : null;
  const cjkShare = cjk / members.length;
  if (cjkShare >= 0.5) return { narrative: "chinese", sub: top, mix, cjk_share: Math.round(cjkShare * 100) / 100 };
  return { narrative: top ?? "mixed", sub: top && ranked[1] && ranked[1][1] / members.length >= minShare ? ranked[1][0] : null, mix, cjk_share: Math.round(cjkShare * 100) / 100 };
}

/** Narrative of a single token, for the card: which families its own tags belong to. */
export function tokenNarratives(t: TokenInfo): string[] {
  const out = new Set<string>();
  if (hasCJK(t.name) || hasCJK(t.symbol)) out.add("chinese");
  for (const tag of t.tags.keys()) for (const [name, set] of RULES) if (set.has(tag)) out.add(name);
  return [...out];
}
