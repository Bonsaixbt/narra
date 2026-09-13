import { similarity, type Tags } from "./tokenize.js";
import { isLive } from "./status.js";
import type { ClusterOut, TokenInfo, VerdictKind } from "./types.js";
import type { TradeRow } from "../store/db.js";

import type { WalletStat } from "./wallets.js";

export interface VerdictContext {
  wallets?: Map<string, WalletStat>;
  /** token → buyers in the last 10 minutes; when present, rotation is measured on these instead of the whole window */
  recentBuyers?: Map<string, Set<string>>;
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
/** IN needs capital evidence, not just a matching name. */
const MIN_OVERLAP_FOR_IN = 2;

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
  if (ctx.wallets && early.size) {
    let rot = 0, hot = 0, snip = 0;
    for (const w of early) { const st = ctx.wallets.get(w); if (!st) continue; if (st.cohorts.includes("rotator")) rot++; if (st.cohorts.includes("early-in-hot")) hot++; if (st.cohorts.includes("sniper")) snip++; }
    if (rot + hot > 0) reasons.push(`${rot} rotator${rot === 1 ? "" : "s"} and ${hot} early-in-hot wallet${hot === 1 ? "" : "s"} among its ${early.size} early buyers`);
    if (snip >= early.size * 0.5 && early.size >= 4) watch.push(`${snip} of ${early.size} early buyers are snipers (bought within 5 s of launch); expect a fast exit`);
  }
  const h = c.heat;
  reasons.push(`cluster ${c.slug} is ${c.status}: ${h.n_launches} CA, ${h.quote_norm_in.toFixed(2)} ETH in, ${h.n_graduated} graduations in window`);
  if (h.graduated_share >= 0.3) watch.push(`${Math.round(h.graduated_share * 100)}% of the cluster already graduated; late launches into it tend to trail`);
  // rotation risk: early buyers who bought into a different cluster in the last 10 minutes (whole window as fallback)
  const source = ctx.recentBuyers ?? ctx.buyers;
  const span = ctx.recentBuyers ? "in the last 10m" : "in this window";
  let moved = 0; let dest: string | null = null;
  const destCount = new Map<string, Set<string>>();
  for (const [tok, set] of source) {
    const slug = ctx.membership.get(tok); if (!slug || slug === c.slug) continue;
    for (const w of early) if (set.has(w)) { let d = destCount.get(slug); if (!d) { d = new Set(); destCount.set(slug, d); } d.add(w); }
  }
  for (const [slug, ws] of destCount) if (ws.size > moved) { moved = ws.size; dest = slug; }
  const movedShare = early.size ? moved / early.size : 0;
  if (dest && movedShare >= 0.3) watch.push(`${moved} of ${early.size} early buyers bought ${dest} ${span} → rotating out risk`);

  let verdict: VerdictKind;
  if (!isLive(c.status)) { verdict = "OUT"; reasons.push(`cluster status ${c.status} — names still print, capital does not`); }
  else if (dest && movedShare >= 0.3) { verdict = "OUT"; reasons.push(`${Math.round(movedShare * 100)}% of early buyers already moved to ${dest}`); }
  else if (best.m >= 0.5 && best.overlap >= MIN_OVERLAP_FOR_IN) verdict = "IN";
  else verdict = "EDGE";
  if (verdict === "EDGE") reasons.push(best.m >= 0.5 ? `words fit but only ${best.overlap} early buyer${best.overlap === 1 ? "" : "s"} overlap with the cluster (IN needs ${MIN_OVERLAP_FOR_IN})` : `membership ${best.m} is below 0.5: words fit, capital overlap is thin`);
  return {
    verdict,
    cluster: { slug: c.slug, status: c.status, membership: best.m },
    alternatives: scores.slice(1, 3).filter((s) => s.m >= 0.1).map((s) => ({ slug: s.slug, membership: s.m })),
    reasons, watch, evidence,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
