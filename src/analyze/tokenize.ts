/**
 * name / symbol / description → weighted tags.
 * Deterministic, dictionary-driven, no ML. The dictionary is open in the repo so anyone can see why two tokens are "close".
 */
import dictionary from "./dictionary.json" with { type: "json" };
import type { PairKind } from "../store/db.js";

export interface TokenizeInput { name?: string; symbol?: string; description?: string; pairKind?: PairKind }
export type Tags = Map<string, number>;

export const WEIGHTS = { symbol: 1.2, name: 1.0, description: 0.4, pair: 0.6 } as const;
const STOP = new Set<string>(dictionary.stop);
const ALIAS = dictionary.alias as Record<string, string>;
const PAIR = dictionary.pair_tags as Record<string, string>;
const CJK: [string, string][] = Object.entries(dictionary.cjk as Record<string, string>).filter(([k]) => !k.startsWith("_")).sort((a, b) => b[0].length - a[0].length);

/** A CJK run → English tags by longest dictionary match, left to right. Unknown characters are skipped. */
export function cjkTags(run: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < run.length) {
    let hit: [string, string] | undefined;
    for (const e of CJK) if (run.startsWith(e[0], i)) { hit = e; break; }
    if (hit) { out.push(hit[1]); i += hit[0].length; } else i++;
  }
  return out;
}

/** Split a string into candidate words: camelCase, digits, punctuation, emoji, CJK runs. */
export function words(s: string): string[] {
  if (!s) return [];
  const spaced = s
    .replace(/[$#@]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")          // camelCase
    .replace(/([A-Za-z])(\d)/g, "$1 $2")           // letters|digits
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase();
  const out: string[] = [];
  for (const m of spaced.matchAll(/[a-z0-9]+|[一-鿿぀-ヿ가-힯]+/g)) {
    const w = m[0];
    if (w.length < 2 && !/[一-鿿]/.test(w)) continue;
    if (w.length > 24) continue;
    out.push(w);
  }
  return out;
}

export function normalize(w: string): string | null {
  const a = ALIAS[w] ?? w;
  if (STOP.has(a)) return null;
  if (/^\d+$/.test(a)) return null;               // bare numbers cluster nothing
  // crude plural stripping for latin words of 5+ letters
  if (/^[a-z]{4,}s$/.test(a) && !a.endsWith("ss") && !a.endsWith("us")) { const sing = a.slice(0, -1); return ALIAS[sing] ?? sing; }
  return a;
}

/** Seeds: canonical tags and alias keys long enough to be recognised inside a compound like HOODRAT or GROKTRENCHER. */
const SEEDS: string[] = [...new Set([...Object.values(ALIAS), ...Object.keys(ALIAS)])].filter((s) => s.length >= 3 && !STOP.has(s)).sort((a, b) => b.length - a.length);

/** "hoodrat" → ["hood", "rat"]; "groktrencher" → ["grok", "trencher"]; a plain word returns []. */
export function splitCompound(w: string): string[] {
  if (w.length < 5 || !/^[a-z]+$/.test(w)) return [];
  for (const s of SEEDS) {
    if (w.length <= s.length + 2) continue; // the remainder must be at least three letters
    if (w.startsWith(s)) { const rest = w.slice(s.length); return [s, ...(splitCompound(rest).length ? splitCompound(rest) : [rest])]; }
    if (w.endsWith(s)) { const rest = w.slice(0, -s.length); return [...(splitCompound(rest).length ? splitCompound(rest) : [rest]), s]; }
  }
  return [];
}

/** A unique compound string cannot match anything, so it carries little weight; its parts carry the full weight. */
const COMPOUND_WHOLE = 0.3;

function add(tags: Tags, w: string, weight: number): void {
  const t = normalize(w);
  if (!t) return;
  tags.set(t, Math.max(tags.get(t) ?? 0, weight)); // max, not sum: repeating a word does not make it heavier
}

function addWord(tags: Tags, w: string, weight: number): void {
  if (/[\u4e00-\u9fff]/.test(w)) {
    // keep the run itself (copycats share it exactly) and add the translated tags at full weight
    add(tags, w, weight);
    for (const t of cjkTags(w)) add(tags, t, weight);
    return;
  }
  const parts = splitCompound(w);
  if (!parts.length) { add(tags, w, weight); return; }
  for (const p of parts) add(tags, p, weight);
  add(tags, w, Math.min(weight, COMPOUND_WHOLE));
}

export function tokenize(input: TokenizeInput): Tags {
  const tags: Tags = new Map();
  for (const w of words(input.symbol ?? "")) addWord(tags, w, WEIGHTS.symbol);
  for (const w of words(input.name ?? "")) addWord(tags, w, WEIGHTS.name);
  const desc = words(input.description ?? "").slice(0, 40); // long descriptions are marketing, the first sentence carries the meta
  for (const w of desc) add(tags, w, WEIGHTS.description);
  if (input.pairKind) tags.set(PAIR[input.pairKind] ?? `pair:${input.pairKind}`, WEIGHTS.pair);
  return tags;
}

/** Weighted Jaccard over two tag maps. 0 when either is empty. */
export function similarity(a: Tags, b: Tags): number {
  if (!a.size || !b.size) return 0;
  let inter = 0, union = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const x = a.get(k) ?? 0, y = b.get(k) ?? 0;
    inter += Math.min(x, y); union += Math.max(x, y);
  }
  return union ? inter / union : 0;
}

/** Tags that carry meaning for clustering: pair tags alone must not glue every ETH launch together. */
export const isContentTag = (t: string) => !t.startsWith("pair:");
