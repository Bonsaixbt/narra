/** Local HTTP on loopback: the same JSON as --json, for any language, n8n, bots. Not a public server. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Args } from "./args.js";
import { str, windowOf } from "./args.js";
import { Narra } from "../narra.js";
import { jsonSchema, SCHEMAS } from "../schemas.js";
import { watchLoop } from "./watch.js";
import { c } from "./render.js";

export async function serve(args: Args): Promise<number> {
  const port = Number(str(args.flags.port) ?? 4663);
  const host = "127.0.0.1";
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  const defaultWindow = windowOf(args.flags.window);
  let syncing: Promise<unknown> | null = null;
  let lastSync = 0;
  const sync = async (w: "15m" | "60m" | "4h") => {
    if (Date.now() - lastSync < 10_000) return;
    if (!syncing) syncing = n.sync(w).finally(() => { syncing = null; lastSync = Date.now(); });
    await syncing;
  };
  const sse = new Set<ServerResponse>();
  const ac = new AbortController();
  void watchLoop(n, { window: defaultWindow, everySec: 15, signal: ac.signal, onEvent: (e) => { const line = `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`; for (const r of sse) r.write(line); } });

  const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const w = windowOf(url.searchParams.get("window") ?? undefined, defaultWindow);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (p === "/" || p === "/health") { const s = n.store.stats(); return json(res, 200, { ok: true, narra: "0.2.0", cursor: n.store.getCursor("main")?.last_block ?? null, ...s, routes: ["/now", "/coin/:ca", "/flow", "/why/:slug", "/stream", "/schema/:name", "/health"] }); }
      if (p === "/now") { await sync(w); return json(res, 200, await n.now({ window: w, noSync: true, members: url.searchParams.get("members") === "1", pair: (url.searchParams.get("pair") ?? "all") as "all" })); }
      if (p === "/flow") { await sync(w); return json(res, 200, await n.flow({ window: w, noSync: true })); }
      if (p.startsWith("/coin/")) { const ca = p.slice(6); if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) return json(res, 400, { error: { code: "BAD_ADDRESS", message: "expected 0x + 40 hex" } }); await sync(w); return json(res, 200, await n.coin(ca, { window: w, noSync: true })); }
      if (p.startsWith("/why/")) { await sync(w); const r = await n.why(decodeURIComponent(p.slice(5)), { window: w, noSync: true }); return r ? json(res, 200, r) : json(res, 404, { error: { code: "NO_CLUSTER", message: "no such cluster in this window" } }); }
      if (p.startsWith("/schema")) { const name = p.split("/")[2]; if (!name) return json(res, 200, Object.fromEntries(Object.keys(SCHEMAS).map((k) => [k, jsonSchema(k as keyof typeof SCHEMAS)]))); if (!(name in SCHEMAS)) return json(res, 404, { error: { code: "NO_SCHEMA", message: Object.keys(SCHEMAS).join(", ") } }); return json(res, 200, jsonSchema(name as keyof typeof SCHEMAS)); }
      if (p === "/stream") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" }); res.write(": narra stream\n\n"); sse.add(res); req.on("close", () => sse.delete(res)); return; }
      return json(res, 404, { error: { code: "NOT_FOUND", message: "see /health for routes" } });
    } catch (err) { return json(res, 500, { error: { code: "INTERNAL", message: (err as Error).message.split("\n")[0] } }); }
  };
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((r) => server.listen(port, host, r));
  console.error(c.dim(`narra serve · http://${host}:${port} · window ${defaultWindow} · routes: /now /coin/:ca /flow /why/:slug /stream /schema · ctrl-c to stop`));
  await new Promise<void>((r) => process.on("SIGINT", () => { ac.abort(); server.close(); r(); }));
  n.close();
  return 0;
}
