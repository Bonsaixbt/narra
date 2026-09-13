/**
 * The semantic layer is optional and pluggable. It adds two things on top of the deterministic core:
 *   - embeddings per token → `semantic` links between tokens whose names mean the same thing
 *   - a label and one-line summary per published cluster
 * It never changes a number. `--no-semantic` (or NARRA_SEMANTIC=off) yields the same board minus semantic links.
 *
 * Config:
 *   NARRA_SEMANTIC=off|on                      master switch (default off in the OSS build)
 *   NARRA_SEMANTIC_EMBED=local|openai|off       default local (transformers.js, multilingual-e5-small, CPU)
 *   NARRA_SEMANTIC_NAME=off|openai|anthropic    default off
 *   NARRA_SEMANTIC_URL / NARRA_SEMANTIC_KEY      OpenAI-compatible base URL (OpenAI, Ollama, LM Studio, OpenRouter) and key
 *   NARRA_SEMANTIC_MODEL                         chat model for naming (provider default otherwise)
 *   NARRA_SEMANTIC_EMBED_MODEL                   embedding model (default Xenova/multilingual-e5-small locally, text-embedding-3-small remotely)
 *   NARRA_SEMANTIC_THRESHOLD                     cosine floor for a semantic link (default 0.86 for e5)
 *   NARRA_SEMANTIC_BUDGET_PER_DAY                remote calls per day (default 500)
 *   ANTHROPIC_API_KEY                            for NARRA_SEMANTIC_NAME=anthropic (the SDK also accepts an `ant auth login` profile)
 */
export interface ClusterNamingInput {
  slug: string;
  tags: string[];
  members: { symbol: string; name: string; description: string }[];
  heat: { n_launches: number; quote_norm_in: number; unique_buyers: number };
}
export interface ClusterNaming { label: string; summary: string }

export interface Embedder { model: string; dim: number | null; embed(texts: string[]): Promise<Float32Array[]> }
export interface Namer { model: string; name(input: ClusterNamingInput): Promise<ClusterNaming> }

export interface SemanticConfig {
  enabled: boolean;
  embed: "local" | "openai" | "off";
  name: "off" | "openai" | "anthropic";
  url: string; key: string; model: string; embedModel: string;
  threshold: number; budgetPerDay: number;
}

export function semanticConfig(env: NodeJS.ProcessEnv = process.env, override?: { off?: boolean }): SemanticConfig {
  const enabled = !override?.off && (env.NARRA_SEMANTIC ?? "off").toLowerCase() === "on";
  const embed = (env.NARRA_SEMANTIC_EMBED ?? "local").toLowerCase() as SemanticConfig["embed"];
  const name = (env.NARRA_SEMANTIC_NAME ?? "off").toLowerCase() as SemanticConfig["name"];
  return {
    enabled, embed: ["local", "openai", "off"].includes(embed) ? embed : "local", name: ["off", "openai", "anthropic"].includes(name) ? name : "off",
    url: (env.NARRA_SEMANTIC_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""), key: env.NARRA_SEMANTIC_KEY ?? env.OPENAI_API_KEY ?? "",
    model: env.NARRA_SEMANTIC_MODEL ?? "", embedModel: env.NARRA_SEMANTIC_EMBED_MODEL ?? "",
    threshold: Number(env.NARRA_SEMANTIC_THRESHOLD ?? 0.86), budgetPerDay: Number(env.NARRA_SEMANTIC_BUDGET_PER_DAY ?? 500),
  };
}

export async function createEmbedder(cfg: SemanticConfig): Promise<Embedder | null> {
  if (!cfg.enabled || cfg.embed === "off") return null;
  if (cfg.embed === "local") return (await import("./local.js")).localEmbedder(cfg.embedModel || "Xenova/multilingual-e5-small");
  return (await import("./openai.js")).openaiEmbedder(cfg);
}

export async function createNamer(cfg: SemanticConfig): Promise<Namer | null> {
  if (!cfg.enabled || cfg.name === "off") return null;
  if (cfg.name === "anthropic") return (await import("./anthropic.js")).anthropicNamer(cfg);
  return (await import("./openai.js")).openaiNamer(cfg);
}

/** The text we embed for a token: name and ticker carry the meta, the first sentence of the description adds context. */
export function embedText(t: { name: string; symbol: string; description: string }): string {
  const desc = (t.description || "").split(/[.!?\n]/)[0].slice(0, 120);
  return `query: ${[t.name, t.symbol, desc].filter(Boolean).join(" · ")}`;
}

export const cosine = (a: Float32Array, b: Float32Array): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export const NAMING_SYSTEM = `You name clusters of freshly launched meme tokens on a launchpad. You get the cluster's shared tags, a sample of member tokens (ticker, name, description) and its numbers. Reply with JSON only: {"label": "<2-4 words, lowercase, hyphenated, e.g. stock-memes or ai-agent-tools>", "summary": "<one sentence, at most 18 words, what these tokens have in common and what the wave is riding>"}. Never give financial advice, never say buy or sell, never invent facts not in the sample.`;

export function namingPrompt(i: ClusterNamingInput): string {
  const sample = i.members.slice(0, 12).map((m) => `- $${m.symbol || "?"} · ${m.name || "?"}${m.description ? " · " + m.description.replace(/\s+/g, " ").slice(0, 100) : ""}`).join("\n");
  return `cluster slug: ${i.slug}\nshared tags: ${i.tags.join(", ") || "(none)"}\nlaunches in window: ${i.heat.n_launches}, ETH in: ${i.heat.quote_norm_in.toFixed(2)}, buyers: ${i.heat.unique_buyers}\nmembers:\n${sample}`;
}

/**
 * The last parseable JSON object in a text. Reasoning models prefix their answer with prose that may contain braces,
 * so the first `{…}` match is not enough: try candidate spans from the end until one parses.
 */
export function extractJson(text: string): unknown | null {
  const opens: number[] = []; for (let i = 0; i < text.length; i++) if (text[i] === "{") opens.push(i);
  const closes: number[] = []; for (let i = text.length - 1; i >= 0; i--) if (text[i] === "}") closes.push(i);
  let tries = 0;
  for (const j of closes) for (const i of opens) { if (i >= j || tries++ > 400) continue; try { return JSON.parse(text.slice(i, j + 1)); } catch { /* next span */ } }
  return null;
}

/** Models to try in order: NARRA_SEMANTIC_MODEL may be a comma-separated list; a 429, 5xx or empty answer moves to the next. */
export function modelList(cfg: SemanticConfig, dflt: string): string[] {
  return (cfg.model || dflt).split(",").map((m) => m.trim()).filter(Boolean);
}
export const OPENAI_FREE_DEFAULTS = "nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free";

export function parseNaming(text: string, fallbackSlug: string): ClusterNaming {
  try {
    const j = (extractJson(text) ?? {}) as { label?: string; summary?: string };
    const label = String(j.label ?? "").toLowerCase().replace(/[^a-z0-9一-鿿-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || fallbackSlug;
    return { label, summary: String(j.summary ?? "").replace(/\s+/g, " ").slice(0, 200) };
  } catch { return { label: fallbackSlug, summary: "" }; }
}
