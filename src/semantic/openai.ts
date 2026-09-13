/** Any OpenAI-compatible server: OpenAI, Ollama (/v1), LM Studio, OpenRouter, vLLM. Plain fetch, no SDK. */
import { NAMING_SYSTEM, namingPrompt, parseNaming, modelList, type Embedder, type Namer, type SemanticConfig } from "./provider.js";

async function post(cfg: SemanticConfig, path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${cfg.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}), "user-agent": "narra/0.2" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${cfg.url}${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export function openaiEmbedder(cfg: SemanticConfig): Embedder {
  const model = cfg.embedModel || "text-embedding-3-small";
  let dim: number | null = null;
  return {
    model, get dim() { return dim; },
    async embed(texts) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 256) {
        const j = (await post(cfg, "/embeddings", { model, input: texts.slice(i, i + 256).map((t) => t.replace(/^query: /, "")) })) as { data: { index: number; embedding: number[] }[] };
        for (const d of j.data.sort((a, b) => a.index - b.index)) { const v = Float32Array.from(d.embedding); let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; for (let k = 0; k < v.length; k++) v[k] /= n; dim = v.length; out.push(v); }
      }
      return out;
    },
  };
}

/** One chat completion with model fallback: 429, 5xx, provider errors and empty answers move to the next model. */
export async function chatWithFallback(cfg: SemanticConfig, models: string[], messages: { role: "system" | "user"; content: string }[], maxTokens: number): Promise<{ text: string; model: string }> {
  const errors: string[] = [];
  for (const model of models) {
    try {
      const j = (await post(cfg, "/chat/completions", { model, temperature: 0, max_tokens: maxTokens, messages })) as { choices?: { message?: { content?: string | null; reasoning?: string } }[]; error?: { message?: string } };
      if (j.error) { errors.push(`${model}: ${j.error.message ?? "error"}`); continue; }
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) { errors.push(`${model}: empty answer`); continue; }
      return { text, model };
    } catch (e) { errors.push(`${model}: ${(e as Error).message.split("\n")[0].slice(0, 120)}`); }
  }
  throw new Error(`every model failed — ${errors.join(" | ")}`);
}

export function openaiNamer(cfg: SemanticConfig): Namer {
  const models = modelList(cfg, "gpt-4o-mini");
  return {
    model: models[0],
    async name(input) {
      const { text } = await chatWithFallback(cfg, models, [{ role: "system", content: NAMING_SYSTEM }, { role: "user", content: namingPrompt(input) }], 400);
      return parseNaming(text, input.slug);
    },
  };
}
