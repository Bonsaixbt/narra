/** MCP over stdio: the same five questions, as tools an agent can call. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Args } from "../cli/args.js";
import { str } from "../cli/args.js";
import { Narra } from "../narra.js";

const Window = z.enum(["15m", "60m", "4h"]).optional().describe("lookback window, default 60m");
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export function buildServer(n: Narra): McpServer {
  const server = new McpServer({ name: "narra", version: "0.1.0" }, { instructions: "narra reads Pons v2 launches on Robinhood Chain and clusters them into metas. When a user brings a contract address, call narra_coin first. Quote the reasons verbatim. IN means the token belongs to a live meta; it is not a buy signal. Do not recommend entering tokens whose verdict is OUT, ORPHAN or whose cluster is DEAD." });
  let lastSync = 0;
  const sync = async (w: "15m" | "60m" | "4h") => { if (Date.now() - lastSync > 10_000) { await n.sync(w); lastSync = Date.now(); } };

  server.registerTool("narra_now", { title: "Live metas on Pons", description: "Which metas (clusters of launches) are HOT, EMERGING, ROTATING, COOLING or DEAD right now, with launches, ETH in, buyers, graduations and flow arrows. Call this for 'what is printing', 'what meta is hot', 'what should I look at'.", inputSchema: { window: Window, pair: z.enum(["all", "eth", "stable", "stock"]).optional(), top: z.number().int().min(1).max(50).optional(), members: z.boolean().optional().describe("include member tokens per cluster") } },
    async ({ window, pair, top, members }) => { const w = window ?? "60m"; await sync(w); return text(await n.now({ window: w, pair, top, members, noSync: true })); });

  server.registerTool("narra_coin", { title: "Is this token in a live meta?", description: "Verdict for one or more Pons v2 contract addresses: IN, EDGE, OUT, ORPHAN or NOT_PONS, with the cluster, membership score, numbered reasons and watch-outs. Call this first whenever a user pastes a 0x address.", inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), addresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(20).optional(), window: Window } },
    async ({ address, addresses, window }) => { const w = window ?? "60m"; const list = [...(address ? [address] : []), ...(addresses ?? [])]; if (!list.length) return text({ error: "pass address or addresses" }); await sync(w); const out = []; for (const a of list) out.push(await n.coin(a, { window: w, noSync: true })); return text(list.length === 1 ? out[0] : out); });

  server.registerTool("narra_flow", { title: "Capital flow between metas", description: "Edges A→B: wallets that bought ≥2 tokens of meta A in the previous window and bought meta B in this one, plus deployers that switched. Use to answer 'where is the money rotating'.", inputSchema: { window: Window } },
    async ({ window }) => { const w = window ?? "60m"; await sync(w); return text(await n.flow({ window: w, noSync: true })); });

  server.registerTool("narra_why", { title: "Explain a meta", description: "Why a cluster is named and grouped the way it is: tags with example tickers, members with membership scores, in/out flow, the linking rule.", inputSchema: { slug: z.string(), window: Window } },
    async ({ slug, window }) => { const w = window ?? "60m"; await sync(w); return text((await n.why(slug, { window: w, noSync: true })) ?? { error: `no cluster ${slug}` }); });

  server.registerTool("narra_doctor", { title: "Health check", description: "RPC reachability, chain id, live Pons parameters vs expectations, cache size and lag.", inputSchema: {} },
    async () => text(await n.doctor()));

  server.registerPrompt("narra_check_before_entry", { title: "Check a CA before discussing entry", description: "Guardrail: run narra_coin, quote reasons, refuse to encourage entries into dead or orphan metas.", argsSchema: { address: z.string() } },
    ({ address }) => ({ messages: [{ role: "user", content: { type: "text", text: `Call narra_coin with address ${address}. Report the verdict, the cluster and its status, and quote the reasons verbatim. If the verdict is OUT or ORPHAN, or the cluster is DEAD or COOLING, say plainly that the meta is not live and do not suggest an entry. IN is membership, not a recommendation.` } }] }));
  return server;
}

export async function serveMcp(args: Args): Promise<number> {
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  const server = buildServer(n);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((r) => { transport.onclose = () => r(); process.on("SIGINT", () => r()); });
  n.close();
  return 0;
}
