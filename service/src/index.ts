/**
 * narra service: the engine behind HTTP + SSE.
 * Public routes answer for everyone; gated routes need a holder cookie once the token exists.
 */
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { getCookie, setCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { jsonSchema, SCHEMAS, type WatchEvent } from "narra-cli";
import { CONFIG, gateEnabled } from "./config.js";
import { Engine, type Window } from "./engine.js";
import { issueToken, verifyToken, readBalance } from "./gate.js";
import { RateLimiter } from "./ratelimit.js";
import { StreamHub } from "./stream.js";
import { clusterCard, coinCard, toPng } from "./og.js";
import { Alerter, alertConfig } from "./alerts.js";
import { CommunityBot, botConfig } from "./bot.js";

const hub = new StreamHub(CONFIG.publicStreamDelaySec);
const alertCfg = alertConfig();
const alerter = alertCfg ? new Alerter(alertCfg) : null;
const engine = new Engine((e) => { hub.publish(e); alerter?.offer(e); });
const anon = new RateLimiter(CONFIG.rateAnon), holders = new RateLimiter(CONFIG.rateHolder);
type Env = { Variables: { holder: { address: string; balance: number } | null; ip: string } };
const app = new Hono<Env>();

const err = (code: string, message: string, status: 400 | 401 | 404 | 429 | 500 | 503) => ({ body: { error: { code, message } }, status });
const windowOf = (v: string | undefined): Window | null => (v === undefined || v === "" || v === "60m" ? "60m" : v === "15m" || v === "4h" ? v : null);
const ready = (w: Window) => engine.get(w);
/** Resolves the window or writes the error: 400 for an unknown value, 400 for one the service is not configured to compute, 503 while warming up. */
const resolveWindow = (c: { req: { query: (k: string) => string | undefined }; json: (b: unknown, s: 400 | 503) => Response }): { w: Window; cached: NonNullable<ReturnType<typeof ready>> } | Response => {
  const w = windowOf(c.req.query("window"));
  if (!w) { const e = err("BAD_WINDOW", "window must be 15m, 60m or 4h", 400); return c.json(e.body, e.status as 400); }
  if (!CONFIG.windows.includes(w)) { const e = err("BAD_WINDOW", `this service computes ${CONFIG.windows.join(", ")} only`, 400); return c.json(e.body, e.status as 400); }
  const cached = ready(w);
  if (!cached) { const e = err("WARMING_UP", `${w} analysis not ready yet`, 503); return c.json(e.body, e.status as 503); }
  return { w, cached };
};

app.use("*", cors({ origin: CONFIG.origin ? [CONFIG.origin] : "*", credentials: !!CONFIG.origin }));
app.use("*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";
  const holder = gateEnabled() ? verifyToken(getCookie(c, "narra_holder") ?? c.req.header("x-narra-holder")) : null;
  c.set("ip", ip); c.set("holder", holder);
  const lim = holder ? holders : anon;
  if (!lim.allow(holder ? holder.address : ip)) { const e = err("RATE_LIMITED", "slow down", 429); return c.json(e.body, e.status); }
  await next();
});
const gated = createMiddleware<Env>(async (c, next) => {
  if (gateEnabled() && !c.get("holder")) { const e = err("HOLDER_REQUIRED", "this route is for $NARRA holders; POST /api/holders/check with a public address", 401); return c.json(e.body, e.status); }
  await next();
});

// community bot: answers from the same cached analyses as the routes
const botCfg = botConfig();
const bot = botCfg ? new CommunityBot(botCfg, {
  now: async (w) => { const cached = ready(w); return cached ? engine.n.now({ analysis: cached, window: w }) : null; },
  coin: async (a) => { const cached = ready("60m"); return cached ? engine.n.coin(a, { analysis: cached, window: "60m" }) : null; },
  why: async (slug) => { const cached = ready("60m"); return cached ? engine.n.why(slug, { analysis: cached, window: "60m" }) : null; },
  find: async (q) => { const cached = ready("60m"); return cached ? engine.n.find(q, { analysis: cached, window: "60m" }) : null; },
  flow: async () => { const cached = ready("60m"); return cached ? engine.n.flow({ analysis: cached, window: "60m" }) : null; },
  trend: async () => engine.n.trend(48, 4),
}) : null;

app.get("/api/health", (c) => { const h = engine.health(); return c.json({ ...h, narra: "service 0.1.0", gate: gateEnabled(), stream_clients: hub.size, alerts: alerter ? { sent: alerter.sent, dropped: alerter.dropped, errors: alerter.errors } : null, bot: bot ? { sent: bot.sent, errors: bot.errors } : null }, h.ok ? 200 : 503); });

app.get("/api/board", async (c) => {
  const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw;
  if (w !== "60m" && gateEnabled() && !c.get("holder")) { const e = err("HOLDER_REQUIRED", "15m and 4h windows are for holders", 401); return c.json(e.body, e.status); }
  return c.json(await engine.n.now({ analysis: cached, window: w, pair: (c.req.query("pair") ?? "all") as "all", members: c.req.query("members") === "1", top: Number(c.req.query("top") ?? 0) || undefined, all: c.req.query("all") === "1" }));
});
app.get("/api/coin/:ca", async (c) => {
  const ca = c.req.param("ca");
  if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) { const e = err("BAD_ADDRESS", "expected 0x + 40 hex", 400); return c.json(e.body, e.status); }
  const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw;
  return c.json(await engine.n.coin(ca, { analysis: cached, window: w }));
});
app.get("/api/find", async (c) => { const q = (c.req.query("q") ?? "").trim(); if (!q) { const e = err("BAD_QUERY", "q is required", 400); return c.json(e.body, e.status); } const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw; return c.json(await engine.n.find(q, { analysis: cached, window: w })); });
app.get("/api/cluster/:slug", async (c) => { const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw; try { const r = await engine.n.why(c.req.param("slug"), { analysis: cached, window: w }); if (!r) { const e = err("NO_CLUSTER", "no such meta in this window", 404); return c.json(e.body, e.status); } return c.json(r); } catch (ex) { const e = err("AMBIGUOUS", (ex as Error).message, 400); return c.json(e.body, e.status); } });
app.get("/api/flow", gated, async (c) => { const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw; return c.json(await engine.n.flow({ analysis: cached, window: w })); });
app.get("/api/wallets", gated, async (c) => { const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw; return c.json(await engine.n.wallets({ analysis: cached, window: w, cohort: c.req.query("cohort") as "rotator" | undefined, sort: c.req.query("sort") as "net_eth" | undefined, top: Number(c.req.query("top") ?? 25) })); });
app.get("/api/wallet/:address", gated, async (c) => { const a = c.req.param("address"); if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { const e = err("BAD_ADDRESS", "expected 0x + 40 hex", 400); return c.json(e.body, e.status); } const rw = resolveWindow(c); if (rw instanceof Response) return rw; const { w, cached } = rw; return c.json(await engine.n.wallet(a, { analysis: cached, window: w })); });
app.get("/api/history/cluster/:slug", gated, (c) => c.json(engine.n.history(c.req.param("slug"), Number(c.req.query("hours") ?? 24))));
app.get("/api/history/token/:ca", gated, (c) => c.json(engine.n.history(c.req.param("ca"), Number(c.req.query("hours") ?? 24))));
app.get("/api/trend", gated, (c) => c.json(engine.n.trend(Number(c.req.query("hours") ?? 48), Number(c.req.query("step") ?? 4))));
app.get("/api/schema/:name", (c) => { const n = c.req.param("name") as keyof typeof SCHEMAS; if (!(n in SCHEMAS)) { const e = err("NO_SCHEMA", Object.keys(SCHEMAS).join(", "), 404); return c.json(e.body, e.status); } return c.json(jsonSchema(n)); });

app.post("/api/holders/check", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { address?: string };
  const a = (body.address ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { const e = err("BAD_ADDRESS", "expected 0x + 40 hex", 400); return c.json(e.body, e.status); }
  if (!gateEnabled()) return c.json({ address: a.toLowerCase(), balance: null, threshold: CONFIG.holderThreshold, ok: true, note: "holder mode opens after launch; every route is open now" });
  const { balance } = await readBalance(engine.n.clients.http, CONFIG.tokenAddress, a);
  const ok = balance >= CONFIG.holderThreshold;
  if (ok) { const t = issueToken(a, balance); setCookie(c, "narra_holder", t, { httpOnly: true, secure: !!CONFIG.origin, sameSite: "Lax", maxAge: CONFIG.holderTtlSec, path: "/" }); return c.json({ address: a.toLowerCase(), balance, threshold: CONFIG.holderThreshold, ok, token: t }); }
  return c.json({ address: a.toLowerCase(), balance, threshold: CONFIG.holderThreshold, ok });
});

app.get("/api/stream", (c) => {
  const holder = !!c.get("holder") || !gateEnabled();
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ delayed_s: holder ? 0 : CONFIG.publicStreamDelaySec }) });
    let open = true;
    const remove = hub.add({ holder, write: (e: WatchEvent) => { if (open) void stream.writeSSE({ event: e.type, data: JSON.stringify(e) }); } });
    stream.onAbort(() => { open = false; remove(); });
    while (open) await stream.sleep(15_000).then(() => stream.writeSSE({ event: "ping", data: "" }));
  });
});

const png = async (c: { header: (k: string, v: string) => void; body: (b: Uint8Array | string, s?: 200 | 503) => Response }, svg: string) => { const buf = await toPng(svg); if (!buf) return c.body("png rasteriser not installed (npm i @resvg/resvg-js); use the svg route", 503); c.header("content-type", "image/png"); c.header("cache-control", "public, max-age=60"); return c.body(buf); };
app.get("/api/og/cluster/:slug/png", async (c) => { const cached = ready("60m"); if (!cached) return c.body("not ready", 503); const r = await engine.n.now({ analysis: cached, window: "60m", all: true }); const k = r.clusters.find((x) => x.slug === c.req.param("slug")); if (!k) return c.body("no such meta", 404); return png(c, clusterCard(k)); });
app.get("/api/og/coin/:ca/png", async (c) => { const ca = c.req.param("ca"); if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) return c.body("bad address", 400); const cached = ready("60m"); if (!cached) return c.body("not ready", 503); const r = await engine.n.coin(ca, { analysis: cached, window: "60m" }); return png(c, coinCard(r)); });
app.get("/api/og/cluster/:slug", async (c) => { const cached = ready("60m"); if (!cached) return c.body("not ready", 503); const r = await engine.n.now({ analysis: cached, window: "60m", all: true }); const k = r.clusters.find((x) => x.slug === c.req.param("slug")); if (!k) return c.body("no such meta", 404); c.header("content-type", "image/svg+xml"); c.header("cache-control", "public, max-age=60"); return c.body(clusterCard(k)); });
app.get("/api/og/coin/:ca", async (c) => { const ca = c.req.param("ca"); if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) return c.body("bad address", 400); const cached = ready("60m"); if (!cached) return c.body("not ready", 503); const r = await engine.n.coin(ca, { analysis: cached, window: "60m" }); c.header("content-type", "image/svg+xml"); c.header("cache-control", "public, max-age=60"); return c.body(coinCard(r)); });

app.notFound((c) => { const e = err("NOT_FOUND", "see /api/health", 404); return c.json(e.body, e.status); });
app.onError((ex, c) => { const e = err("INTERNAL", ex.message.split("\n")[0], 500); return c.json(e.body, e.status); });

engine.start();
bot?.start();
serve({ fetch: app.fetch, port: CONFIG.port, hostname: CONFIG.host }, (info) => console.error(`narra service · http://${info.address}:${info.port}/api · windows ${CONFIG.windows.join(",")} · gate ${gateEnabled() ? "on" : "off (no token yet)"} · public stream delay ${CONFIG.publicStreamDelaySec}s`));
process.on("SIGINT", () => { engine.close(); hub.stop(); alerter?.stop(); bot?.stop(); process.exit(0); });
process.on("SIGTERM", () => { engine.close(); hub.stop(); alerter?.stop(); bot?.stop(); process.exit(0); });
