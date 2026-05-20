import { DATA_API_BASE } from "@poly-shine/shared";
import { INGEST_ACTIVITY_TYPES, type IngestActivityType } from "./leaderActivity.js";
import { fetchConditionTokenIds } from "./ctf.js";

/** Polls Polymarket Data API. For lower latency, upgrade to the authenticated CLOB User WebSocket channel. */
export type DataApiTrade = {
  proxyWallet?: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId?: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  icon?: string;
  outcome?: string;
  transactionHash?: string;
};

export type DataApiActivity = {
  proxyWallet?: string;
  timestamp: number;
  conditionId?: string;
  type: IngestActivityType | string;
  size: number;
  usdcSize?: number;
  transactionHash?: string;
  price?: number;
  asset?: string;
  side?: "BUY" | "SELL";
  outcomeIndex?: number;
  title?: string;
  icon?: string;
  outcome?: string;
};

/** Normalized leader row fields derived from activity (trade or CTF). */
export type NormalizedLeaderActivity = {
  asset: string;
  conditionId: string | null;
  side: string;
  size: number;
  price: number;
  timestamp: number;
  transactionHash: string | null;
  activityType: string;
  raw: Record<string, unknown>;
};

const FETCH_TIMEOUT_MS = 12_000;
const FETCH_ATTEMPTS = 3;

async function fetchDataApi(url: URL): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export async function fetchUserTrades(userAddress: string, limit = 100): Promise<DataApiTrade[]> {
  const url = new URL(`${DATA_API_BASE}/trades`);
  url.searchParams.set("user", userAddress.toLowerCase());
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("takerOnly", "false");
  const res = await fetchDataApi(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Data API trades ${res.status}: ${t}`);
  }
  return (await res.json()) as DataApiTrade[];
}

export const ACTIVITY_PAGE_SIZE = 100;
/** Max pages per tick (~1000 events) — bounds API load during catch-up after downtime. */
export const MAX_ACTIVITY_PAGES = 10;

export async function fetchUserActivity(userAddress: string, limit = ACTIVITY_PAGE_SIZE): Promise<DataApiActivity[]> {
  const url = new URL(`${DATA_API_BASE}/activity`);
  url.searchParams.set("user", userAddress.toLowerCase());
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("type", INGEST_ACTIVITY_TYPES.join(","));
  url.searchParams.set("sortBy", "TIMESTAMP");
  url.searchParams.set("sortDirection", "DESC");
  const res = await fetchDataApi(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Data API activity ${res.status}: ${t}`);
  }
  return (await res.json()) as DataApiActivity[];
}

/** Whether another DESC-sorted activity page may contain events newer than `sinceTimestampSec`. */
export function shouldFetchNextActivityPage(
  page: DataApiActivity[],
  pageSize: number,
  sinceTimestampSec: number | null,
  pagesFetched: number,
  maxPages: number
): boolean {
  if (pagesFetched >= maxPages) return false;
  if (page.length < pageSize) return false;
  if (sinceTimestampSec == null) return false;
  let oldest = Infinity;
  for (const row of page) {
    const ts = typeof row.timestamp === "number" ? row.timestamp : 0;
    if (ts < oldest) oldest = ts;
  }
  if (!Number.isFinite(oldest)) return false;
  return oldest > sinceTimestampSec;
}

/**
 * Fetch leader activity with offset pagination when catching up after `sinceTimestampSec`.
 * Without a cursor, returns a single page (live steady-state).
 */
export async function fetchUserActivitySince(
  userAddress: string,
  sinceTimestampSec: number | null,
  pageSize = ACTIVITY_PAGE_SIZE,
  maxPages = MAX_ACTIVITY_PAGES
): Promise<DataApiActivity[]> {
  const collected: DataApiActivity[] = [];
  let offset = 0;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const url = new URL(`${DATA_API_BASE}/activity`);
    url.searchParams.set("user", userAddress.toLowerCase());
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("type", INGEST_ACTIVITY_TYPES.join(","));
    url.searchParams.set("sortBy", "TIMESTAMP");
    url.searchParams.set("sortDirection", "DESC");

    const res = await fetchDataApi(url);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Data API activity ${res.status}: ${t}`);
    }

    const page = (await res.json()) as DataApiActivity[];
    pagesFetched += 1;
    collected.push(...page);

    if (!shouldFetchNextActivityPage(page, pageSize, sinceTimestampSec, pagesFetched, maxPages)) {
      break;
    }
    offset += pageSize;
  }

  return collected;
}

export function tradeDedupeKey(t: DataApiTrade): string {
  const tx = t.transactionHash ?? "unknown";
  return `${tx}:${t.asset}:${t.side}:${t.size}:${t.price}:${t.timestamp}`;
}

export function activityDedupeKey(a: NormalizedLeaderActivity): string {
  const tx = a.transactionHash ?? "unknown";
  return `${a.activityType}:${tx}:${a.asset}:${a.side}:${a.size}:${a.price}:${a.timestamp}`;
}

/** Resolve outcome token id(s) for CTF rows (Polymarket often leaves asset empty on MERGE). */
export function resolveCtfActivityAssets(
  activity: DataApiActivity,
  conditionTokenIds: string[] | null
): string[] {
  const direct = activity.asset?.trim();
  if (direct) return [direct];
  if (conditionTokenIds?.length) return [...conditionTokenIds];
  const cond = activity.conditionId?.trim();
  if (cond) return [`condition:${cond.toLowerCase()}`];
  return [];
}

function buildNormalizedCtf(
  a: DataApiActivity,
  type: IngestActivityType,
  asset: string
): NormalizedLeaderActivity | null {
  const size = Number(a.size);
  if (!Number.isFinite(size) || size <= 0) return null;

  const timestamp = typeof a.timestamp === "number" ? a.timestamp : 0;
  const raw = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
  const usdc = Number(a.usdcSize);
  const price =
    Number.isFinite(usdc) && usdc > 0 && size > 0 ? usdc / size : 1;

  return {
    asset,
    conditionId: a.conditionId ?? null,
    side: type,
    size,
    price,
    timestamp,
    transactionHash: a.transactionHash ?? null,
    activityType: type,
    raw,
  };
}

/** One API activity → one or more leader rows (CTF without asset expands per outcome token). */
export async function expandLeaderActivities(a: DataApiActivity): Promise<NormalizedLeaderActivity[]> {
  const type = String(a.type ?? "").toUpperCase();
  if (!INGEST_ACTIVITY_TYPES.includes(type as IngestActivityType)) return [];

  if (type === "TRADE") {
    const asset = a.asset?.trim();
    if (!asset) return [];
    const size = Number(a.size);
    if (!Number.isFinite(size) || size <= 0) return [];
    const price = Number(a.price);
    if (!Number.isFinite(price) || price <= 0) return [];

    const timestamp = typeof a.timestamp === "number" ? a.timestamp : 0;
    const raw = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
    const side = a.side === "SELL" ? "SELL" : "BUY";
    return [
      {
        asset,
        conditionId: a.conditionId ?? null,
        side,
        size,
        price,
        timestamp,
        transactionHash: a.transactionHash ?? null,
        activityType: type,
        raw,
      },
    ];
  }

  if (type === "MERGE" || type === "SPLIT" || type === "REDEEM") {
    let tokenIds: string[] | null = null;
    if (!a.asset?.trim() && a.conditionId) {
      tokenIds = await fetchConditionTokenIds(a.conditionId);
    }
    const assets = resolveCtfActivityAssets(a, tokenIds);
    const out: NormalizedLeaderActivity[] = [];
    for (const asset of assets) {
      const row = buildNormalizedCtf(a, type, asset);
      if (row) out.push(row);
    }
    return out;
  }

  return [];
}

/** @deprecated Prefer expandLeaderActivities — MERGE rows often have asset "". */
export function normalizeLeaderActivity(a: DataApiActivity): NormalizedLeaderActivity | null {
  const asset = a.asset?.trim();
  if (!asset) return null;

  const type = String(a.type ?? "").toUpperCase();
  if (type === "TRADE") {
    const size = Number(a.size);
    if (!Number.isFinite(size) || size <= 0) return null;
    const price = Number(a.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const timestamp = typeof a.timestamp === "number" ? a.timestamp : 0;
    const raw = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
    return {
      asset,
      conditionId: a.conditionId ?? null,
      side: a.side === "SELL" ? "SELL" : "BUY",
      size,
      price,
      timestamp,
      transactionHash: a.transactionHash ?? null,
      activityType: type,
      raw,
    };
  }

  if (type === "MERGE" || type === "SPLIT" || type === "REDEEM") {
    return buildNormalizedCtf(a, type as IngestActivityType, asset);
  }

  return null;
}
