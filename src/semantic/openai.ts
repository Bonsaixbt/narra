/** Any OpenAI-compatible server: OpenAI, Ollama (/v1), LM Studio, OpenRouter, vLLM. Plain fetch, no SDK. */
import { NAMING_SYSTEM, namingPrompt, parseNaming, type Embedder, type Namer, type SemanticConfig } from "./provider.js";

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

export function openaiNamer(cfg: SemanticConfig): Namer {
  const model = cfg.model || "gpt-4o-mini";
  return {
    model,
    async name(input) {
      const j = (await post(cfg, "/chat/completions", { model, temperature: 0.2, max_tokens: 200, messages: [{ role: "system", content: NAMING_SYSTEM }, { role: "user", content: namingPrompt(input) }] })) as { choices: { message: { content: string } }[] };
      return parseNaming(j.choices[0]?.message?.content ?? "", input.slug);
    },
  };
}
