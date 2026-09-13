/** Local embeddings through transformers.js (ONNX on CPU). Optional dependency: npm i @huggingface/transformers. */
import { join } from "node:path";
import { homedir } from "node:os";
import type { Embedder } from "./provider.js";

export async function localEmbedder(model: string): Promise<Embedder> {
  let mod: typeof import("@huggingface/transformers");
  try { mod = await import("@huggingface/transformers"); }
  catch { throw new Error("local embeddings need @huggingface/transformers: npm i @huggingface/transformers (or set NARRA_SEMANTIC_EMBED=openai / off)"); }
  mod.env.cacheDir = process.env.NARRA_MODEL_DIR ?? join(homedir(), ".narra", "models");
  const pipe = await mod.pipeline("feature-extraction", model, { dtype: "q8" });
  let dim: number | null = null;
  return {
    model, get dim() { return dim; },
    async embed(texts) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const t = await pipe(texts.slice(i, i + 64), { pooling: "mean", normalize: true });
        const rows = t.tolist() as number[][];
        for (const r of rows) { dim = r.length; out.push(Float32Array.from(r)); }
      }
      return out;
    },
  };
}
