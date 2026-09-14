/**
 * The RPC gate. Every JSON-RPC call narra makes passes through here.
 *
 * Public endpoints on this chain behave differently: publicnode is fast for eth_call but refuses eth_getLogs;
 * the official Robinhood node serves logs but answers 429 above a handful of concurrent calls and hands
 * a Cloudflare challenge to clients that keep hammering it. So: single requests (no batching), a per-endpoint
 * concurrency cap, routing by capability, and a penalty box for endpoints that just refused us.
 */
import { createPublicClient, custom, webSocket, type PublicClient, type Transport } from "viem";
import { CHAIN, DEFAULT_ENDPOINTS, DEFAULT_WS, type EndpointSpec } from "./constants.js";

export interface GateOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  /** Minimum spacing between eth_getLogs calls to the same endpoint, ms. */
  logsSpacingMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface EndpointState extends EndpointSpec {
  active: number;
  queue: (() => void)[];
  benchedUntil: number;
  lastLogsAt: number;
  calls: number;
  refusals: number;
}

export interface GateStats {
  maxLogRange: number;
  calls: number;
  refusals: number;
  /** calls per JSON-RPC method since start: what the quota is spent on */
  by_method: Record<string, number>;
  endpoints: { label: string; logs: boolean; benched: boolean; calls: number; refusals: number; concurrency: number }[];
}

export class RpcError extends Error {
  constructor(message: string, public code?: number, public data?: unknown) { super(message); }
}

export interface Gate {
  request(method: string, params?: unknown[]): Promise<unknown>;
  stats(): GateStats;
  labels(): string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createGate(specs: EndpointSpec[] = DEFAULT_ENDPOINTS, opts: GateOptions = {}): Gate {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 6;
  const logsSpacingMs = opts.logsSpacingMs ?? 250;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const eps: EndpointState[] = specs.map((s) => ({ ...s, active: 0, queue: [], benchedUntil: 0, lastLogsAt: 0, calls: 0, refusals: 0 }));
  let nextId = 1;
  let totalCalls = 0;
  const byMethod = new Map<string, number>();
  let totalRefusals = 0;

  const candidates = (method: string): EndpointState[] => {
    const able = eps.filter((e) => method !== "eth_getLogs" || e.logs);
    const t = now();
    const healthy = able.filter((e) => e.benchedUntil <= t);
    if (healthy.length) return healthy;
    return [...able].sort((a, b) => a.benchedUntil - b.benchedUntil).slice(0, 1);
  };

  const acquire = async (e: EndpointState, method: string) => {
    if (e.active >= e.concurrency) await new Promise<void>((r) => e.queue.push(r));
    e.active++;
    if (method === "eth_getLogs") {
      const wait = e.lastLogsAt + logsSpacingMs - now();
      if (wait > 0) await sleep(wait);
      e.lastLogsAt = now();
    }
  };
  const release = (e: EndpointState) => { e.active--; e.queue.shift()?.(); };

  // Providers cap the block span of eth_getLogs (Chainstack, Alchemy, QuickNode all differently). The first refusal
  // teaches the gate the cap; later calls are pre-split instead of failing first.
  let learnedMaxRange = Infinity;
  const request = async (method: string, params: unknown[] = []): Promise<unknown> => {
    const f = params[0] as { fromBlock?: string; toBlock?: string } | undefined;
    const split = async (from: number, to: number) => {
      const mid = from + Math.floor((to - from) / 2);
      const [a, b] = await Promise.all([
        request(method, [{ ...f, fromBlock: "0x" + from.toString(16), toBlock: "0x" + mid.toString(16) }]),
        request(method, [{ ...f, fromBlock: "0x" + (mid + 1).toString(16), toBlock: "0x" + to.toString(16) }]),
      ]);
      return [...(a as unknown[]), ...(b as unknown[])];
    };
    if (method === "eth_getLogs" && f?.fromBlock && f?.toBlock && /^0x/.test(f.fromBlock) && /^0x/.test(f.toBlock)) {
      const from = Number(BigInt(f.fromBlock)), to = Number(BigInt(f.toBlock));
      if (to - from + 1 > learnedMaxRange && to > from) return split(from, to);
    }
    try {
      return await requestOnce(method, params);
    } catch (err) {
      if (method === "eth_getLogs" && f?.fromBlock && f?.toBlock && /range|too many|exceed|limit|span/i.test((err as Error).message)) {
        const from = Number(BigInt(f.fromBlock)), to = Number(BigInt(f.toBlock));
        if (to > from) {
          learnedMaxRange = Math.min(learnedMaxRange, Math.max(1, Math.floor((to - from + 1) / 2)));
          return split(from, to);
        }
      }
      throw err;
    }
  };

  const requestOnce = async (method: string, params: unknown[] = []): Promise<unknown> => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params });
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const list = candidates(method);
      if (!list.length) throw new RpcError(`${method}: no endpoint serves this method (eth_getLogs needs an endpoint with logs=true)`);
      const ep = list[Math.min(attempt, list.length - 1)];
      await acquire(ep, method);
      ep.calls++; totalCalls++; byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
      let status = 0; let text = "";
      try {
        const res = await fetchFn(ep.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "narra/0.1" }, body, signal: AbortSignal.timeout(timeoutMs) });
        status = res.status; text = await res.text();
      } catch (err) {
        release(ep);
        lastErr = `${ep.label}: ${(err as Error).message}`;
        ep.benchedUntil = now() + 3_000;
        await sleep(200 * (attempt + 1));
        continue;
      }
      release(ep);
      if (status === 429 || status === 503) {
        ep.refusals++; totalRefusals++;
        ep.benchedUntil = now() + 5_000;
        lastErr = `${ep.label}: HTTP ${status}`;
        await sleep(list.length > 1 ? 50 : Math.min(10_000, 300 * 2 ** attempt));
        continue;
      }
      if (status === 403 && /cloudflare|just a moment|challenge/i.test(text)) {
        ep.refusals++; totalRefusals++;
        ep.benchedUntil = now() + 60_000;
        lastErr = `${ep.label}: bot challenge`;
        await sleep(list.length > 1 ? 50 : 5_000);
        continue;
      }
      let json: { result?: unknown; error?: { code: number; message: string; data?: unknown } };
      try { json = JSON.parse(text); } catch {
        lastErr = `${ep.label}: HTTP ${status} non-JSON`;
        ep.benchedUntil = now() + 3_000;
        await sleep(200);
        continue;
      }
      if (json.error) {
        if (json.error.code === 429 || (/rate|too many requests/i.test(json.error.message) && !/range/i.test(json.error.message))) {
          ep.refusals++; totalRefusals++;
          ep.benchedUntil = now() + 5_000;
          lastErr = `${ep.label}: ${json.error.message}`;
          await sleep(list.length > 1 ? 50 : Math.min(10_000, 300 * 2 ** attempt));
          continue;
        }
        throw new RpcError(json.error.message, json.error.code, json.error.data);
      }
      return json.result;
    }
    throw new RpcError(`${method}: gave up after ${retries + 1} attempts (${lastErr})`);
  };

  return {
    request,
    stats: () => ({
      maxLogRange: learnedMaxRange,
      calls: totalCalls,
      refusals: totalRefusals,
      by_method: Object.fromEntries(byMethod),
      endpoints: eps.map((e) => ({ label: e.label, logs: e.logs, benched: e.benchedUntil > now(), calls: e.calls, refusals: e.refusals, concurrency: e.concurrency })),
    }),
    labels: () => eps.map((e) => e.label).join("+"),
  };
}

/** Parse `NARRA_RPC_URL` / `--rpc`: comma-separated URLs, `#nologs` suffix marks an endpoint that refuses eth_getLogs. */
export function parseEndpoints(raw: string | undefined): EndpointSpec[] {
  const s = raw?.trim();
  if (!s) return DEFAULT_ENDPOINTS;
  return s.split(",").map((u) => u.trim()).filter(Boolean).map((u) => {
    const nologs = u.endsWith("#nologs");
    const url = nologs ? u.slice(0, -7) : u;
    const known = DEFAULT_ENDPOINTS.find((d) => d.url === url);
    return known ?? { url, logs: !nologs, label: new URL(url).hostname, concurrency: 6 };
  });
}

export interface Clients {
  http: PublicClient;
  ws: PublicClient | null;
  gate: Gate;
  wsUrl: string | null;
}

export function gateTransport(gate: Gate): Transport {
  return custom({ request: ({ method, params }) => gate.request(method, (params as unknown[]) ?? []) }, { retryCount: 0 });
}

export function createClients(opts: { endpoints?: EndpointSpec[]; ws?: string | "off"; gate?: Gate } = {}): Clients {
  const gate = opts.gate ?? createGate(opts.endpoints ?? DEFAULT_ENDPOINTS);
  const http = createPublicClient({ chain: CHAIN, transport: gateTransport(gate) });
  const wsUrl = opts.ws === "off" ? null : (opts.ws ?? DEFAULT_WS);
  const ws = wsUrl ? createPublicClient({ chain: CHAIN, transport: webSocket(wsUrl, { reconnect: true }) }) : null;
  return { http, ws, gate, wsUrl };
}
