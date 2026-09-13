/**
 * Grow the narrative dictionary with a model in the loop, a human on the pen.
 * `narra dictionary suggest` collects the words that carry the most ETH but belong to no family, asks the configured
 * chat model to sort them into the existing families (or `skip`), and prints a JSON patch. `--write` merges the patch
 * into dictionary.json. Nothing is written without the flag, and every suggestion carries its ETH and count so the
 * reviewer can see what it would change.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Args } from "./args.js";
import { str } from "./args.js";
import { open, printJson } from "./common.js";
import { c, table } from "./render.js";
import { tokenize, isContentTag, isCategoryTag } from "../analyze/tokenize.js";
import { semanticConfig, modelList, extractJson } from "../semantic/provider.js";
import { chatWithFallback } from "../semantic/openai.js";
import dictionary from "../analyze/dictionary.json" with { type: "json" };

const DICT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "analyze", "dictionary.json");

export interface Candidate { tag: string; tokens: number; eth: number; examples: string[] }

/** Words with weight in the window that no narrative family knows. */
export function unmatchedTags(rows: { name: string; symbol: string; description: string; eth: number }[], top = 60): Candidate[] {
  const fam = new Set<string>();
  for (const [k, v] of Object.entries(dictionary.narratives as Record<string, string[] | string>)) if (!k.startsWith("_") && Array.isArray(v)) for (const w of v) fam.add(w);
  const acc = new Map<string, Candidate>();
  for (const r of rows) {
    const tags = tokenize({ name: r.name, symbol: r.symbol, description: r.description });
    for (const [t, w] of tags) {
      if (!isContentTag(t) || isCategoryTag(t) || fam.has(t) || w < 1 || /^[一-鿿]+$/.test(t) || t.length < 3) continue;
      let cnd = acc.get(t); if (!cnd) { cnd = { tag: t, tokens: 0, eth: 0, examples: [] }; acc.set(t, cnd); }
      cnd.tokens++; cnd.eth += r.eth; if (cnd.examples.length < 3 && r.symbol && !cnd.examples.includes(r.symbol)) cnd.examples.push(r.symbol);
    }
  }
  return [...acc.values()].filter((x) => x.tokens >= 3).sort((a, b) => b.eth - a.eth).slice(0, top).map((x) => ({ ...x, eth: Math.round(x.eth * 100) / 100 }));
}

export const SORT_SYSTEM = `You maintain a dictionary that sorts meme-token names into narrative families. You get a list of words with how many tokens used them and how much ETH those tokens attracted, plus the existing families. Assign each word to exactly one family, or "skip" when the word is generic, a brand-new meme with no family, a person's name you do not recognise, or noise. Never invent families. Reply with JSON only: {"assignments": {"word": "family-or-skip", ...}}.`;

export async function dictionaryCmd(args: Args): Promise<number> {
  const sub = args.pos[0] ?? "suggest";
  if (sub !== "suggest") { console.error("usage: narra dictionary suggest [--hours 48] [--top 60] [--write] [--json]"); return 10; }
  const hours = Number(str(args.flags.hours) ?? 48), top = Number(str(args.flags.top) ?? 60);
  const { n } = open({ ...args, flags: { ...args.flags, offline: true } });
  try {
    const now = n.store.stats().newest_trade_ts ?? Math.floor(Date.now() / 1000);
    const since = now - hours * 3600;
    const eth = n.store.db.prepare(`SELECT token, SUM(CASE WHEN side = 'buy' THEN COALESCE(quote_norm, 0) END) AS eth FROM curve_trades WHERE ts >= ? AND token IS NOT NULL GROUP BY token
      UNION ALL SELECT token, quote_in FROM hourly WHERE hour_ts >= ?`).all(since, since) as { token: string; eth: number }[];
    const byToken = new Map<string, number>(); for (const r of eth) byToken.set(r.token, (byToken.get(r.token) ?? 0) + (r.eth ?? 0));
    const meta = n.store.tokensFor([...byToken.keys()]);
    const rows = [...byToken].map(([token, e]) => { const m = meta.get(token); return { name: m?.name ?? "", symbol: m?.symbol ?? "", description: m?.description ?? "", eth: e }; }).filter((r) => r.name || r.symbol);
    const cands = unmatchedTags(rows, top);
    const families = Object.keys(dictionary.narratives).filter((k) => !k.startsWith("_"));
    const cfg = semanticConfig({ ...process.env, NARRA_SEMANTIC: "on" });
    let assignments: Record<string, string> = {};
    let model = "none";
    if (cfg.name !== "off") {
      model = cfg.name === "anthropic" ? (cfg.model || "claude-opus-5") : modelList(cfg, "gpt-4o-mini").join(" → ");
      try { const r = await sortWithModel(cfg, families, cands); assignments = r.assignments; model = r.model; } catch (e) { console.error(c.red(`model call failed: ${(e as Error).message.split("\n")[0]}`)); model = "failed"; }
    }
    const patch: Record<string, string[]> = {};
    for (const [w, fam] of Object.entries(assignments)) if (fam !== "skip" && families.includes(fam) && cands.some((x) => x.tag === w)) (patch[fam] ??= []).push(w);
    const out = { hours, model, candidates: cands, patch };
    if (args.flags.json) printJson(out);
    else {
      console.log(`${c.bold("narra dictionary suggest")}  last ${hours}h  ${cands.length} unmatched words${model !== "none" ? `  sorted by ${model}` : "  (no NARRA_SEMANTIC_NAME provider: candidates only)"}`);
      console.log(table([["word", "tokens", "ETH", "examples", "→ family"], ...cands.map((x) => [x.tag, String(x.tokens), x.eth.toFixed(2), x.examples.join(" "), assignments[x.tag] ? (assignments[x.tag] === "skip" ? c.dim("skip") : c.cyan(assignments[x.tag])) : c.dim("?")])], [18, 7, 9, 28, 0]));
      if (Object.keys(patch).length) { console.log("\npatch:"); console.log(JSON.stringify(patch, null, 2)); }
      else console.log(c.dim("\nno assignments; set NARRA_SEMANTIC_NAME=openai (Ollama, Groq, OpenRouter) or anthropic to sort them, or add words to dictionary.json by hand"));
    }
    if (args.flags.write && Object.keys(patch).length) {
      const cur = JSON.parse(readFileSync(DICT_PATH, "utf8")) as { narratives: Record<string, string[] | string> };
      for (const [fam, words] of Object.entries(patch)) { const list = cur.narratives[fam]; if (Array.isArray(list)) for (const w of words) if (!list.includes(w)) list.push(w); }
      writeFileSync(DICT_PATH, JSON.stringify(cur, null, 2) + "\n");
      console.error(c.green(`written to ${DICT_PATH} — review the diff with git before committing`));
    }
    return 0;
  } finally { n.close(); }
}

/** One chat call: words → families. Uses the same OpenAI-compatible or Anthropic transport as cluster naming. */
export async function sortWithModel(cfg: ReturnType<typeof semanticConfig>, families: string[], cands: Candidate[]): Promise<{ assignments: Record<string, string>; model: string }> {
  const user = `families: ${families.join(", ")}\n\nwords (word · tokens · ETH · example tickers):\n${cands.map((x) => `- ${x.tag} · ${x.tokens} · ${x.eth} · ${x.examples.join(" ")}`).join("\n")}`;
  let text = "";
  let model = cfg.model;
  if (cfg.name === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = cfg.key ? new Anthropic({ apiKey: cfg.key }) : new Anthropic();
    model = cfg.model || "claude-opus-5";
    const res = await client.messages.create({ model, max_tokens: 2048, system: SORT_SYSTEM, output_config: { effort: "low" }, messages: [{ role: "user", content: user }] });
    if (res.stop_reason === "refusal") return { assignments: {}, model };
    for (const b of res.content) if (b.type === "text") text += b.text;
  } else {
    const r = await chatWithFallback(cfg, modelList(cfg, "gpt-4o-mini"), [{ role: "system", content: SORT_SYSTEM }, { role: "user", content: user }], 6000);
    text = r.text; model = r.model;
  }
  const j = (extractJson(text) ?? {}) as { assignments?: Record<string, string> };
  return { assignments: Object.fromEntries(Object.entries(j.assignments ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()])), model };
}
