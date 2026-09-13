/**
 * The analysis child process behind `narra terminal`. Clustering a busy hour takes seconds of CPU; done in the
 * UI process it would freeze the keys. The child owns its own Narra (own SQLite connection, WAL makes that safe)
 * and answers `prepare` and `coin` requests over the fork IPC channel with plain, cloneable objects.
 */
import { Narra, type QueryOptions } from "../narra.js";
import { membersOf } from "../analyze/board.js";
import type { ClusterOut, MemberOut, Edge } from "../analyze/types.js";
import type { WalletStat } from "../analyze/wallets.js";
import type { CoinOut, NotPonsOut } from "../schemas.js";
import { str, type Args } from "./args.js";

export interface Snapshot {
  head_block: number | null;
  clusters: (ClusterOut & { members_out: MemberOut[] })[];
  edges: Edge[];
  counts: { candidates: number; clustered: number; trades: number; launches: number; sprayers: number };
  launches: { token: string; symbol: string; name: string; phase: string; ts: number; slug: string | null }[];
  wallets: WalletStat[];
}

export type WorkerRequest = { id: number; op: "prepare"; window: QueryOptions["window"]; offline: boolean } | { id: number; op: "coin"; address: string; window: QueryOptions["window"] };
export type WorkerReply = { id: number; ok: true; result: Snapshot | CoinOut | NotPonsOut } | { id: number; ok: false; error: string };

export async function runWorker(args: Args): Promise<number> {
  const n = new Narra({ rpc: str(args.flags.rpc), db: str(args.flags.db) });
  const send = (m: WorkerReply) => process.send?.(m);
  process.on("message", async (req: WorkerRequest) => {
    try {
      if (req.op === "prepare") {
        const { a, meta } = await n.prepare({ window: req.window, noSync: req.offline });
        const snap: Snapshot = {
          head_block: meta.head_block,
          clusters: a.clusters.map((c) => ({ ...c, members_out: membersOf(a, c, n.store) })),
          edges: a.edges,
          counts: a.counts,
          launches: a.launches.map((l) => { const t = a.tokens.get(l.token); return { token: l.token, symbol: t?.symbol ?? "", name: t?.name ?? "", phase: t?.phase ?? "curve", ts: l.ts, slug: a.membership.get(l.token) ?? null }; }),
          wallets: [...a.wallets.values()].filter((w) => w.cohorts.length && w.buys > 0).sort((x, y) => y.net_eth - x.net_eth).slice(0, 300),
        };
        send({ id: req.id, ok: true, result: snap });
      } else if (req.op === "coin") {
        send({ id: req.id, ok: true, result: await n.coin(req.address, { window: req.window, noSync: true }) });
      }
    } catch (e) { send({ id: req.id, ok: false, error: (e as Error).message.split("\n")[0] }); }
  });
  process.on("disconnect", () => { n.close(); process.exit(0); });
  send({ id: 0, ok: true, result: { head_block: null, clusters: [], edges: [], counts: { candidates: 0, clustered: 0, trades: 0, launches: 0, sprayers: 0 }, launches: [], wallets: [] } });
  await new Promise(() => {}); // lives until the parent disconnects
  return 0;
}
