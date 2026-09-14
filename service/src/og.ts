/** Share cards as SVG (1200×630). PNG for X previews comes from the same SVG through a rasteriser at the edge. */
import type { NowOut, CoinOut, NotPonsOut } from "narrahood";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const COLOR: Record<string, string> = { HOT: "#FF5A36", "ROTATING IN": "#FF5A36", EMERGING: "#FFB020", COOLING: "#4F8CFF", DEAD: "#4A4F58", "ROTATING OUT": "#B66CFF", IN: "#3DDC97", EDGE: "#FFB020", OUT: "#B66CFF", ORPHAN: "#8A8F99", NOT_PONS: "#FF5A36" };
const frame = (lines: { text: string; size?: number; color?: string; weight?: number }[]) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0B0C0E"/><g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#E6E7EA">${lines.map((l, i) => `<text x="64" y="${120 + i * 66}" font-size="${l.size ?? 34}" font-weight="${l.weight ?? 400}" fill="${l.color ?? "#E6E7EA"}">${esc(l.text)}</text>`).join("")}</g><text x="64" y="590" font-family="ui-monospace, Menlo, monospace" font-size="22" fill="#8A8F99">narra · IN means membership in a live meta, not a recommendation · ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</text></svg>`;

export function clusterCard(k: NowOut["clusters"][number]): string {
  const h = k.heat;
  return frame([
    { text: `${k.slug}`, size: 56, weight: 700 },
    { text: `${k.status} · ${k.narrative}${k.narrative_sub ? " · " + k.narrative_sub : ""} · #${k.rank} on the board`, color: COLOR[k.status] ?? "#E6E7EA" },
    { text: `${h.n_launches} launches · ${h.quote_norm_in.toFixed(1)} ETH in · ${h.unique_buyers.toLocaleString("en-US")} buyers · ${h.n_graduated} graduated` },
    { text: `flow ⇦ ${k.flow.in_wallets} wallets in · ⇨ ${k.flow.out_wallets} out${k.rotating_from ? " · from " + k.rotating_from : ""}`, color: "#8A8F99" },
    { text: `tags ${k.top_tags.map((t) => t.tag).slice(0, 5).join("  ")}`, color: "#8A8F99", size: 28 },
  ]);
}

export function coinCard(r: CoinOut | NotPonsOut): string {
  if (r.verdict === "NOT_PONS") return frame([{ text: r.token, size: 30 }, { text: "NOT_PONS", size: 56, weight: 700, color: COLOR.NOT_PONS }, { text: r.reasons[0] ?? "", size: 28, color: "#8A8F99" }]);
  return frame([
    { text: `${r.symbol ? "$" + r.symbol : r.name || "(no symbol)"} · ${r.phase}${r.curve && r.phase === "curve" ? ` ${r.curve.real_quote_eth?.toFixed(2) ?? "?"}/${r.curve.threshold_eth} ${r.pair.symbol}` : ""}`, size: 40, weight: 700 },
    { text: `${r.verdict}${r.cluster ? `  ${r.cluster.slug}  ${r.cluster.membership.toFixed(2)}  (${r.cluster.status})` : ""}`, size: 48, weight: 700, color: COLOR[r.verdict] ?? "#E6E7EA" },
    ...(r.popularity?.cluster_rank ? [{ text: `meta #${r.popularity.cluster_rank} of ${r.popularity.clusters_total} · ${r.popularity.buyers} buyers, more than ${r.popularity.buyers_percentile}% of tokens`, color: "#8A8F99" }] : []),
    ...r.reasons.filter((x) => !x.startsWith("popularity:")).slice(0, 3).map((t) => ({ text: "· " + t, size: 26 })),
    ...r.watch.slice(0, 1).map((t) => ({ text: "! " + t, size: 26, color: "#FFB020" })),
  ]);
}

/** PNG through resvg when the optional dependency is installed; null otherwise (serve the SVG). */
export async function toPng(svg: string): Promise<Uint8Array | null> {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const r = new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true } });
    return r.render().asPng();
  } catch { return null; }
}
