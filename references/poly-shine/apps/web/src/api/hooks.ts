import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "./client";
import { useLiveSubscription, type LiveChannel } from "./live";
import { readPollCache, writePollCache } from "./poll-cache";

import type {

  AuditEntry,

  EngineState,

  Execution,

  LeaderEvent,

  MirrorIntent,

  TradeFeedItem,

  StatusResponse,

  ConnectivityResponse,

  Subscription,

  EquityBatchResponse,

  MeResponse,

  PolymarketEquity,

  PolymarketPortfolioSnapshot,

  PortfolioBatchResponse,

  ResolvedPolymarketMarket,

  ScreenerTickResponse,

} from "../types";



export type PollOptions = {
  cacheKey?: string;
};

export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs = 5000,
  options?: PollOptions
) {
  const cacheKey = options?.cacheKey;
  const [data, setData] = useState<T | null>(() =>
    cacheKey ? readPollCache<T>(cacheKey) : null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(cacheKey && readPollCache<T>(cacheKey)));

  const refresh = useCallback(async () => {
    try {
      const next = await fetcher();
      setData(next);
      setError(null);
      if (cacheKey) writePollCache(cacheKey, next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [fetcher, cacheKey]);



  useEffect(() => {

    void refresh();

    const id = setInterval(() => void refresh(), intervalMs);

    return () => clearInterval(id);

  }, [refresh, intervalMs]);



  return { data, error, loading, refresh };

}

export type LivePollOptions = PollOptions & {
  fallbackIntervalMs?: number;
};

/** Polls on mount and when the live SSE stream signals matching channels; long fallback if SSE drops. */
export function useLivePoll<T>(
  fetcher: () => Promise<T>,
  channels: LiveChannel[],
  options?: LivePollOptions
) {
  const cacheKey = options?.cacheKey;
  const fallbackIntervalMs = options?.fallbackIntervalMs ?? 90_000;
  const [data, setData] = useState<T | null>(() =>
    cacheKey ? readPollCache<T>(cacheKey) : null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(cacheKey && readPollCache<T>(cacheKey)));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(null);
      if (cacheKey) writePollCache(cacheKey, next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useLiveSubscription(channels, refresh);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), fallbackIntervalMs);
    return () => clearInterval(id);
  }, [refresh, fallbackIntervalMs]);

  return { data, error, loading, refresh };
}

export const fetchStatus = () => api<StatusResponse>("/api/status");

export const fetchConnectivity = () => api<ConnectivityResponse>("/api/connectivity");

export const fetchEngine = () => api<EngineState | null>("/api/engine");

export const fetchSubs = () => api<Subscription[]>("/api/subscriptions");

export const fetchEvents = (limit = 12) => api<LeaderEvent[]>(`/api/events?limit=${limit}`);

export const fetchIntents = (limit = 12) => api<MirrorIntent[]>(`/api/intents?limit=${limit}`);

export const fetchExecs = (limit = 12) => api<Execution[]>(`/api/executions?limit=${limit}`);

export const fetchFeed = (limit = 20) => api<TradeFeedItem[]>(`/api/feed?limit=${limit}`);

export const fetchBalance = () => api<{ usd: number | null; error?: string }>("/api/balance");

export const fetchFollowerEquity = () => api<PolymarketEquity>("/api/follower/equity");

export const fetchMe = () => api<MeResponse>("/api/me");

export const fetchAudit = () => api<AuditEntry[]>("/api/audit?limit=15");



export async function fetchEquity(user: string) {
  const q = encodeURIComponent(user.trim());
  return api<PolymarketEquity>(`/api/equity?user=${q}`);
}

export async function fetchWorkshopPortfolio(user: string) {
  const q = encodeURIComponent(user.trim());
  return api<PolymarketPortfolioSnapshot>(`/api/workshop/portfolio?user=${q}`);
}

export async function fetchWorkshopPortfolioBatch(addresses: string[]) {
  if (addresses.length === 0) return { portfolios: {} } satisfies PortfolioBatchResponse;
  return api<PortfolioBatchResponse>("/api/workshop/portfolio/batch", {
    method: "POST",
    body: JSON.stringify({ addresses }),
  });
}

export async function resolveWorkshopMarket(input: string) {
  return api<{ markets: ResolvedPolymarketMarket[] }>("/api/workshop/screener/resolve", {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

export async function refreshWorkshopMarkets(markets: ResolvedPolymarketMarket[]) {
  return api<{ open: ResolvedPolymarketMarket[]; removed: ResolvedPolymarketMarket[] }>(
    "/api/workshop/screener/markets/refresh",
    {
      method: "POST",
      body: JSON.stringify({ markets }),
    }
  );
}

export async function workshopScreenerTick(
  conditionId: string,
  cacheTimes: Record<string, number>
) {
  return api<ScreenerTickResponse>("/api/workshop/screener/tick", {
    method: "POST",
    body: JSON.stringify({ conditionId, cacheTimes }),
  });
}

export async function workshopScreenerTickBatch(
  conditionIds: string[],
  cacheTimes: Record<string, number>
) {
  return api<{ ticks: ScreenerTickResponse[]; failedConditionIds: string[] }>(
    "/api/workshop/screener/tick-batch",
    {
      method: "POST",
      body: JSON.stringify({ conditionIds, cacheTimes }),
    }
  );
}

export async function fetchEquityBatch(addresses: string[]) {

  if (addresses.length === 0) return { balances: {} } satisfies EquityBatchResponse;

  return api<EquityBatchResponse>("/api/equity/batch", {

    method: "POST",

    body: JSON.stringify({ addresses }),

  });

}



export async function patchEngine(body: Partial<EngineState>) {

  return api<EngineState>("/api/engine", { method: "PATCH", body: JSON.stringify(body) });

}



export async function pauseEngine() {

  return api<EngineState>("/api/engine/pause", { method: "POST" });

}



export async function resumeEngine() {

  return api<EngineState>("/api/engine/resume", { method: "POST" });

}



export type AddSubBody =

  | { address: string; label?: string; sizingMode: "fixed_usd"; fixedUsd: number }

  | { address: string; label?: string; sizingMode: "pct_balance"; pctBalance: number }

  | { address: string; label?: string; sizingMode: "pct_leader_notional"; pctLeaderNotional: number }
  | { address: string; label?: string; sizingMode: "proportional_equity"; proportionalScale?: number };



export async function addSubscription(body: AddSubBody) {

  return api<Subscription>("/api/subscriptions", {

    method: "POST",

    body: JSON.stringify({ ...body, active: true, maxNotionalPerTrade: 500, maxOrdersPerSecond: 5 }),

  });

}



export async function toggleSub(id: string) {

  return api<Subscription>(`/api/subscriptions/${id}/toggle`, { method: "POST" });

}



export async function deleteSub(id: string) {

  return api<{ ok: boolean }>(`/api/subscriptions/${id}`, { method: "DELETE" });

}

export type UpdateSubSizingBody =
  | { sizingMode: "fixed_usd"; fixedUsd: number }
  | { sizingMode: "pct_balance"; pctBalance: number }
  | { sizingMode: "pct_leader_notional"; pctLeaderNotional: number }
  | { sizingMode: "proportional_equity"; proportionalScale?: number };

export async function updateSubSizing(id: string, body: UpdateSubSizingBody) {
  return api<Subscription>(`/api/subscriptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function globalReset() {
  return api<{ ok: boolean }>("/api/admin/reset", { method: "POST" });
}

