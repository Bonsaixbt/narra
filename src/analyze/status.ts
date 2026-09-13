import thresholds from "./thresholds.json" with { type: "json" };
import type { Edge, Heat, Status } from "./types.js";

export type Thresholds = typeof thresholds;
export const THRESHOLDS: Thresholds = thresholds;

export function statusOf(h: Heat, edgesIn: Edge[], edgesOut: Edge[], t: Thresholds = THRESHOLDS): Status {
  const inW = edgesIn.reduce((s, e) => s + e.wallets, 0);
  const outW = edgesOut.reduce((s, e) => s + e.wallets, 0);
  const delta = h.delta_pct;
  const hot = h.n_launches >= t.hot.min_launches && h.quote_norm_in >= t.hot.min_quote_eth && h.n_graduated >= t.hot.min_graduations;
  const emerging = !hot && h.n_launches < t.emerging.max_launches && delta !== null && delta >= t.emerging.min_delta_pct && h.unique_buyers >= t.emerging.min_buyers;
  if (h.n_alive === 0) return "DEAD";
  if (outW >= t.rotating.min_wallets && delta !== null && delta < 0) return "ROTATING OUT";
  if ((hot || emerging) && inW >= t.rotating.min_wallets) return "ROTATING IN";
  if (hot) return "HOT";
  if (emerging) return "EMERGING";
  if (h.n_launches >= t.cooling.min_launches && h.quote_norm_in < t.cooling.max_quote_eth && delta !== null && delta < t.cooling.max_delta_pct) return "COOLING";
  // Nothing decisive: real money on at least two live curves reads as EMERGING, a trickle reads as COOLING.
  return h.n_alive >= 2 && h.quote_norm_in >= t.quiet.min_quote_eth ? "EMERGING" : "COOLING";
}

export const STATUS_ORDER: Status[] = ["ROTATING IN", "HOT", "EMERGING", "ROTATING OUT", "COOLING", "DEAD"];
export const isLive = (s: Status) => s === "HOT" || s === "EMERGING" || s === "ROTATING IN";
