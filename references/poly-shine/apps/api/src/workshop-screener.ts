import {
  fetchMarketParticipants,
  fetchPolymarketPortfolioBatch,
  type MarketParticipant,
} from "@poly-shine/shared";

export const SCREENER_PORTFOLIO_CACHE_TTL_SEC = 25;
export const SCREENER_MAX_PORTFOLIO_REFRESH = 20;

export type WorkshopScreenerTickResult = {
  tickAt: string;
  participants: MarketParticipant[];
  portfolios: Awaited<ReturnType<typeof fetchPolymarketPortfolioBatch>>;
};

function parseCacheTimes(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export async function runWorkshopScreenerTick(
  conditionId: string,
  cacheTimesRaw: unknown
): Promise<WorkshopScreenerTickResult> {
  const cacheTimes = parseCacheTimes(cacheTimesRaw);
  const nowSec = Math.floor(Date.now() / 1000);

  const participants = await fetchMarketParticipants(conditionId);
  const toRefresh: { address: string; cachedSec: number }[] = [];

  for (const p of participants) {
    const cached = cacheTimes[p.address];
    const cachedSec = typeof cached === "number" ? cached : 0;
    if (nowSec - cachedSec >= SCREENER_PORTFOLIO_CACHE_TTL_SEC) {
      toRefresh.push({ address: p.address, cachedSec });
    }
  }

  toRefresh.sort((a, b) => a.cachedSec - b.cachedSec);
  const refreshAddresses = toRefresh
    .slice(0, SCREENER_MAX_PORTFOLIO_REFRESH)
    .map((x) => x.address);

  const portfolios =
    refreshAddresses.length > 0
      ? await fetchPolymarketPortfolioBatch(refreshAddresses)
      : {};

  return {
    tickAt: new Date().toISOString(),
    participants,
    portfolios,
  };
}

export async function runWorkshopScreenerTickBatch(
  conditionIds: string[],
  cacheTimesRaw: unknown
): Promise<{ ticks: WorkshopScreenerTickResult[]; failedConditionIds: string[] }> {
  const uniqueIds = [...new Set(conditionIds.map((id) => id.trim()).filter(Boolean))];
  const settled = await Promise.allSettled(
    uniqueIds.map((id) => runWorkshopScreenerTick(id, cacheTimesRaw))
  );

  const ticks: WorkshopScreenerTickResult[] = [];
  const failedConditionIds: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    const id = uniqueIds[i]!;
    if (result.status === "fulfilled") ticks.push(result.value);
    else failedConditionIds.push(id);
  }

  return { ticks, failedConditionIds };
}
