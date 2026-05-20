import type { PolymarketPortfolioSnapshot } from "./polymarket-portfolio.js";

export type ScreenerFilters = {
  minEquity?: number;
  maxEquity?: number;
  minCash?: number;
  maxCash?: number;
  minPositionsValue?: number;
  maxPositionsValue?: number;
  minOpenPnl?: number;
  maxOpenPnl?: number;
  minPositionCount?: number;
  maxPositionCount?: number;
  minPnlDay?: number;
  maxPnlDay?: number;
  minPnlWeek?: number;
  maxPnlWeek?: number;
  minPnlMonth?: number;
  maxPnlMonth?: number;
  minPnlAll?: number;
  maxPnlAll?: number;
  minVolAll?: number;
  maxVolAll?: number;
  minMarketStake?: number;
  maxMarketStake?: number;
  positivePnlDay?: boolean;
  positivePnlWeek?: boolean;
  positivePnlMonth?: boolean;
  positivePnlAll?: boolean;
};

function inRange(value: number | null | undefined, min?: number, max?: number): boolean {
  const hasMin = min != null && Number.isFinite(min);
  const hasMax = max != null && Number.isFinite(max);
  if (!hasMin && !hasMax) return true;
  if (value == null || !Number.isFinite(value)) return false;
  if (hasMin && value < min!) return false;
  if (hasMax && value > max!) return false;
  return true;
}

function isPositivePnl(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0;
}

export function passesScreenerFilters(
  portfolio: PolymarketPortfolioSnapshot,
  filters: ScreenerFilters,
  marketStake: number | null
): boolean {
  const e = portfolio.equity;
  const p = portfolio.positions;
  const lb = portfolio.leaderboard;

  if (!inRange(e.equity, filters.minEquity, filters.maxEquity)) return false;
  if (!inRange(e.cashBalance, filters.minCash, filters.maxCash)) return false;
  if (!inRange(e.positionsValue, filters.minPositionsValue, filters.maxPositionsValue)) return false;
  if (!inRange(p.openCashPnl, filters.minOpenPnl, filters.maxOpenPnl)) return false;
  if (!inRange(p.count, filters.minPositionCount, filters.maxPositionCount)) return false;
  if (!inRange(lb.day?.pnl, filters.minPnlDay, filters.maxPnlDay)) return false;
  if (!inRange(lb.week?.pnl, filters.minPnlWeek, filters.maxPnlWeek)) return false;
  if (!inRange(lb.month?.pnl, filters.minPnlMonth, filters.maxPnlMonth)) return false;
  if (!inRange(lb.all?.pnl, filters.minPnlAll, filters.maxPnlAll)) return false;
  if (!inRange(lb.all?.vol, filters.minVolAll, filters.maxVolAll)) return false;
  if (!inRange(marketStake, filters.minMarketStake, filters.maxMarketStake)) return false;
  if (filters.positivePnlDay && !isPositivePnl(lb.day?.pnl)) return false;
  if (filters.positivePnlWeek && !isPositivePnl(lb.week?.pnl)) return false;
  if (filters.positivePnlMonth && !isPositivePnl(lb.month?.pnl)) return false;
  if (filters.positivePnlAll && !isPositivePnl(lb.all?.pnl)) return false;

  return true;
}

export function hasActiveScreenerFilters(filters: ScreenerFilters): boolean {
  return Object.values(filters).some((v) => v === true || (v != null && Number.isFinite(v)));
}
