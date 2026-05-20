import { DATA_API_BASE } from "./constants.js";
import { withFetchRetry } from "./fetch-retry.js";
import { isValidEthAddress, normalizeAddress } from "./polymarket-profile.js";

export type LeaderboardTimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";

export type LeaderboardUserStats = {
  pnl: number;
  vol: number;
  rank: string | null;
  userName: string | null;
};

type LeaderboardRow = {
  rank?: string | number;
  pnl?: number;
  vol?: number;
  userName?: string;
};

export async function fetchPolymarketLeaderboardUser(
  userAddress: string,
  timePeriod: LeaderboardTimePeriod
): Promise<LeaderboardUserStats | null> {
  const user = normalizeAddress(userAddress);
  if (!isValidEthAddress(user)) throw new Error("Invalid Ethereum address");

  const url = new URL(`${DATA_API_BASE}/v1/leaderboard`);
  url.searchParams.set("user", user);
  url.searchParams.set("timePeriod", timePeriod);
  url.searchParams.set("orderBy", "PNL");
  url.searchParams.set("limit", "1");

  const res = await withFetchRetry(() => fetch(url, { signal: AbortSignal.timeout(25_000) }));
  if (!res.ok) throw new Error(`Leaderboard HTTP ${res.status}`);

  const rows = (await res.json()) as LeaderboardRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const row = rows[0]!;
  return {
    pnl: Number(row.pnl ?? 0),
    vol: Number(row.vol ?? 0),
    rank: row.rank != null ? String(row.rank) : null,
    userName: row.userName?.trim() || null,
  };
}

export type PolymarketLeaderboardPnls = {
  day: LeaderboardUserStats | null;
  week: LeaderboardUserStats | null;
  month: LeaderboardUserStats | null;
  all: LeaderboardUserStats | null;
};

export async function fetchPolymarketLeaderboardPnls(
  userAddress: string
): Promise<PolymarketLeaderboardPnls> {
  const periods: LeaderboardTimePeriod[] = ["DAY", "WEEK", "MONTH", "ALL"];
  const entries = await Promise.all(
    periods.map(async (period) => {
      try {
        return { period, stats: await fetchPolymarketLeaderboardUser(userAddress, period) };
      } catch {
        return { period, stats: null as LeaderboardUserStats | null };
      }
    })
  );

  const byPeriod = Object.fromEntries(entries.map((e) => [e.period, e.stats])) as Record<
    LeaderboardTimePeriod,
    LeaderboardUserStats | null
  >;

  return {
    day: byPeriod.DAY ?? null,
    week: byPeriod.WEEK ?? null,
    month: byPeriod.MONTH ?? null,
    all: byPeriod.ALL ?? null,
  };
}
