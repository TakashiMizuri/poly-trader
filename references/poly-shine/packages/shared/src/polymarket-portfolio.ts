import { fetchPolymarketEquity, type PolymarketEquity } from "./polymarket-equity.js";
import { fetchPolymarketLeaderboardPnls, type PolymarketLeaderboardPnls } from "./polymarket-leaderboard.js";
import {
  fetchPolymarketPositionsSummary,
  type PolymarketPositionsSummary,
} from "./polymarket-positions.js";
import { mapWithConcurrency } from "./async-pool.js";
import {
  fetchPolymarketPublicProfile,
  isValidEthAddress,
  normalizeAddress,
  resolvePolymarketDisplayName,
} from "./polymarket-profile.js";

const PORTFOLIO_CONCURRENCY = 3;

export type PolymarketPortfolioSnapshot = {
  address: string;
  displayName: string | null;
  equity: PolymarketEquity;
  positions: Pick<PolymarketPositionsSummary, "count" | "openCashPnl">;
  leaderboard: PolymarketLeaderboardPnls;
};

export async function fetchPolymarketPortfolio(userAddress: string): Promise<PolymarketPortfolioSnapshot> {
  const address = normalizeAddress(userAddress);
  if (!isValidEthAddress(address)) throw new Error("Invalid Ethereum address");

  const [equity, positionsResult, leaderboard, profile] = await Promise.all([
    fetchPolymarketEquity(address),
    fetchPolymarketPositionsSummary(address).catch(
      (): PolymarketPositionsSummary => ({ count: 0, openCashPnl: 0, openCurrentValue: 0 })
    ),
    fetchPolymarketLeaderboardPnls(address),
    fetchPolymarketPublicProfile(address).catch(() => null),
  ]);

  const profileName = profile ? resolvePolymarketDisplayName(profile) : null;
  const displayName =
    profileName ?? leaderboard.all?.userName ?? leaderboard.month?.userName ?? null;

  return {
    address,
    displayName,
    equity,
    positions: {
      count: positionsResult.count,
      openCashPnl: positionsResult.openCashPnl,
    },
    leaderboard,
  };
}

export async function fetchPolymarketPortfolioBatch(
  addresses: string[]
): Promise<Record<string, PolymarketPortfolioSnapshot | { error: string }>> {
  const unique = [...new Set(addresses.map(normalizeAddress))];
  const out: Record<string, PolymarketPortfolioSnapshot | { error: string }> = {};

  await mapWithConcurrency(unique, PORTFOLIO_CONCURRENCY, async (addr) => {
    try {
      out[addr] = await fetchPolymarketPortfolio(addr);
    } catch (e) {
      out[addr] = { error: e instanceof Error ? e.message : "Failed to load portfolio" };
    }
  });

  return out;
}
