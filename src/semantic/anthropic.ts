/** Cluster naming through the official Anthropic SDK. Optional dependency: npm i @anthropic-ai/sdk. */
import { NAMING_SYSTEM, namingPrompt, parseNaming, type Namer, type SemanticConfig } from "./provider.js";

export async function anthropicNamer(cfg: SemanticConfig): Promise<Namer> {
  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try { Anthropic = (await import("@anthropic-ai/sdk")).default; }
  catch { throw new Error("NARRA_SEMANTIC_NAME=anthropic needs @anthropic-ai/sdk: npm i @anthropic-ai/sdk"); }
  // Credentials resolve from ANTHROPIC_API_KEY or an `ant auth login` profile; NARRA_SEMANTIC_KEY overrides.
  const client = cfg.key && cfg.name === "anthropic" ? new Anthropic({ apiKey: cfg.key }) : new Anthropic();
  const model = cfg.model || "claude-opus-5";
  return {
    model,
    async name(input) {
      const response = await client.messages.create({
        model,
        max_tokens: 256,
        system: [{ type: "text", text: NAMING_SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "low" },
        messages: [{ role: "user", content: namingPrompt(input) }],
      });
      if (response.stop_reason === "refusal") return { label: input.slug, summary: "" };
      let text = "";
      for (const block of response.content) if (block.type === "text") text += block.text;
      return parseNaming(text, input.slug);
    },
  };
}
