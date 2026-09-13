/**
 * narra as a library.
 *
 *   import { createNarra } from "narra-cli";
 *   const narra = createNarra();                 // public RPCs, cache in ~/.narra
 *   const board = await narra.now();             // same object as `narra now --json`
 *   const card  = await narra.coin("0x…");
 *   narra.close();
 */
export { Narra, type NarraOptions, type QueryOptions, type DoctorReport } from "./narra.js";
export { tokenize, similarity, words, normalize, splitCompound } from "./analyze/tokenize.js";
export { buildClusters, dropSprayers, inheritSlugs, buyersByToken, centroidOf } from "./analyze/cluster.js";
export { statusOf, THRESHOLDS, isLive } from "./analyze/status.js";
export { heatOf } from "./analyze/heat.js";
export { flowEdges } from "./analyze/flow.js";
export { verdictFor } from "./analyze/verdict.js";
export { analyze, membersOf, type Analysis } from "./analyze/board.js";
export { computeTrend, clusterHistory, tokenHistory } from "./analyze/trend.js";
export { narrativeOf, tokenNarratives } from "./analyze/narrative.js";
export { walletStats, cohortMix } from "./analyze/wallets.js";
export { resolveCluster, type FindOut } from "./narra.js";
export { liveTrigger } from "./ingest/live.js";
export { loadEnv } from "./env.js";
export { SCHEMAS, SCHEMA_VERSION, jsonSchema } from "./schemas.js";
export type { NowOut, CoinOut, NotPonsOut, FlowOut, WhyOut, WatchEvent } from "./schemas.js";
export type { Status, VerdictKind, Heat, Edge, ClusterOut, MemberOut, TokenInfo } from "./analyze/types.js";
export { CHAIN, ADDR, PROTOCOL, DEFAULT_ENDPOINTS } from "./chain/constants.js";
export { TOPICS } from "./chain/topics.js";
export { createGate, createClients, parseEndpoints } from "./chain/rpc.js";
export { Store } from "./store/db.js";
export { watchLoop, diffEvents } from "./cli/watch.js";
export { buildServer as buildMcpServer } from "./mcp/server.js";

import { Narra, type NarraOptions } from "./narra.js";
export function createNarra(opts: NarraOptions = {}): Narra { return new Narra(opts); }
