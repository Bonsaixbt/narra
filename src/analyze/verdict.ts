import { similarity, type Tags } from "./tokenize.js";
import { isLive } from "./status.js";
import type { ClusterOut, TokenInfo, VerdictKind } from "./types.js";
import type { TradeRow } from "../store/db.js";

export interface VerdictContext {
  clusters: ClusterOut[];
  centroids: Map<string, Tags>;
  membership: Map<string, string>;           // token → slug
  buyers: Map<string, Set<string>>;          // token → buyers in window
  tokens: Map<string, TokenInfo>;
  window: { from: number; to: number };
}

export interface VerdictCore {
  verdict: VerdictKind;
  cluster: { slug: string; status: ClusterOut["status"]; membership: number } | null;
  alternatives: { slug: string; membership: number }[];
  reasons: string[]; watch: string[];
  evidence: { early_buyers: number; overlap_buyers: number; text_score: number; wallet_score: number };
}

const EARLY_BUYS = 100;

export function verdictFor(t: TokenInfo, tokenTrades: TradeRow[], ctx: VerdictContext): VerdictCore {
  const early = new Set<string>();
  for (const tr of tokenTrades) { if (tr.side === "buy" && early.size < EARLY_BUYS) early.add(tr.recipient); }
  const scores: { slug: string; text: number; wallet: number; overlap: number; m: number; c: ClusterOut }[] = [];
  for (const c of ctx.clusters) {
    const cen = ctx.centroids.get(c.slug); if (!cen) continue;
    const text = Math.min(1, similarity(t.tags, cen) * 2);
    let overlap = 0;
    if (early.size) {
      const others = c.members.filter((m) => m !== t.token);
      const bought = new Set<string>();
      for (const m of others) { const b = ctx.buyers.get(m); if (!b) continue; for (const w of early) if (b.has(w)) bought.add(w); }
      overlap = bought.size;
    }
    const wallet = early.size ? overlap / early.size : 0;
    const m = round2(0.5 * text + 0.5 * Math.min(1, wallet * 2));
    scores.push({ slug: c.slug, text, wallet, overlap, m, c });
  }
  scores.sort((a, b) => b.m - a.m);
  const best = scores[0];
  const reasons: string[] = [];
  const watch: string[] = [];
  const evidence = { early_buyers: early.size, overlap_buyers: best?.overlap ?? 0, text_score: round2(best?.text ?? 0), wallet_score: round2(best?.wallet ?? 0) };
  if (!best || best.m < 0.25) {
    reasons.push(early.size ? `no live cluster shares its words or its ${early.size} early buyers` : "no live cluster shares its words and it has no buyers yet");
    return { verdict: "ORPHAN", cluster: null, alternatives: scores.slice(0, 2).map((s) => ({ slug: s.slug, membership: s.m })), reasons, watch, evidence };
  }
  const c = best.c;
  const matched = [...t.tags.keys()].filter((k) => c.top_tags.some((x) => x.tag === k));
  if (matched.length) reasons.push(`${t.symbol ? "$" + t.symbol : "name"} matches cluster tags ${matched.slice(0, 3).join(", ")}`);
  if (best.overlap) {
    const ex = c.members.filter((m) => m !== t.token).map((m) => ctx.tokens.get(m)?.symbol).filter(Boolean).slice(0, 2).map((s) => "$" + s).join(", ");
    reasons.push(`${best.overlap}/${early.size} early buyers also bought ${ex || "other members"} in this window`);
  } else if (early.size) reasons.push(`none of its ${early.size} early buyers bought other members`);
  const h = c.heat;
  reasons.push(`cluster ${c.slug} is ${c.status}: ${h.n_launches} CA, ${h.quote_norm_in.toFixed(2)} ETH in, ${h.n_graduated} graduations in window`);
  if (h.graduated_share >= 0.3) watch.push(`${Math.round(h.graduated_share * 100)}% of the cluster already graduated; late launches into it tend to trail`);
  // rotation risk: early buyers active in a different cluster in the last 10 minutes
  const recentCut = ctx.window.to - 600;
  let moved = 0; let dest: string | null = null;
  const destCount = new Map<string, number>();
  for (const [tok, set] of ctx.buyers) {
    const slug = ctx.membership.get(tok); if (!slug || slug === c.slug) continue;
    for (const w of early) if (set.has(w)) { destCount.set(slug, (destCount.get(slug) ?? 0) + 1); }
  }
  for (const [slug, n] of destCount) if (n > moved) { moved = n; dest = slug; }
  const movedShare = early.size ? moved / early.size : 0;
  void recentCut; // buyer sets are window-wide in v0.1; a 10-minute slice is a v0.2 refinement
  if (dest && movedShare >= 0.3) watch.push(`${moved} of ${early.size} early buyers are also in ${dest} → rotating out risk`);

  let verdict: VerdictKind;
  if (!isLive(c.status)) { verdict = "OUT"; reasons.push(`cluster status ${c.status} — names still print, capital does not`); }
  else if (dest && movedShare >= 0.3) { verdict = "OUT"; reasons.push(`${Math.round(movedShare * 100)}% of early buyers already moved to ${dest}`); }
  else if (best.m >= 0.5) verdict = "IN";
  else verdict = "EDGE";
  if (verdict === "EDGE") reasons.push(`membership ${best.m} is below 0.5: words fit, capital overlap is thin`);
  return {
    verdict,
    cluster: { slug: c.slug, status: c.status, membership: best.m },
    alternatives: scores.slice(1, 3).filter((s) => s.m >= 0.1).map((s) => ({ slug: s.slug, membership: s.m })),
    reasons, watch, evidence,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
