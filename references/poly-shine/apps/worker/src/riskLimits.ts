import type { ClobClient } from "@polymarket/clob-client-v2";
import type { Db } from "@poly-shine/db";
import { fetchPolymarketEquity, type PolymarketEquity } from "@poly-shine/shared";
import { loadDayStartEquity, saveDayStartEquity, utcDayKey } from "./dailyLossBaseline.js";

const dayStartByAddress = new Map<string, { dayKey: string; equity: number }>();

export async function fetchFollowerEquity(
  followerAddress: string
): Promise<PolymarketEquity | { skipReason: string }> {
  try {
    return await fetchPolymarketEquity(followerAddress);
  } catch {
    return { skipReason: "equity_snapshot_failed" };
  }
}

export function checkMaxOpenExposure(params: {
  equity: PolymarketEquity;
  additionalBuyNotional: number;
  maxOpenExposureUsd: string | null;
}): { ok: true } | { skipReason: string } {
  const cap = params.maxOpenExposureUsd != null ? Number(params.maxOpenExposureUsd) : null;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return { ok: true };

  const current = params.equity.positionsValue;
  if (!Number.isFinite(current)) return { skipReason: "exposure_snapshot_invalid" };

  if (current + params.additionalBuyNotional > cap) {
    return { skipReason: "max_open_exposure_exceeded" };
  }
  return { ok: true };
}

export async function checkMaxDailyLoss(
  db: Db,
  params: {
    followerAddress: string;
    equity: PolymarketEquity;
    maxDailyLossUsd: string | null;
  }
): Promise<{ ok: true } | { skipReason: string }> {
  const cap = params.maxDailyLossUsd != null ? Number(params.maxDailyLossUsd) : null;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return { ok: true };

  const addr = params.followerAddress.toLowerCase();
  const dayKey = utcDayKey();

  let dayStart = dayStartByAddress.get(addr);
  if (!dayStart || dayStart.dayKey !== dayKey) {
    const persisted = await loadDayStartEquity(db, addr, dayKey);
    if (persisted != null) {
      dayStart = { dayKey, equity: persisted };
      dayStartByAddress.set(addr, dayStart);
    }
  }

  if (!dayStart || dayStart.dayKey !== dayKey) {
    const equity = params.equity.equity;
    dayStartByAddress.set(addr, { dayKey, equity });
    await saveDayStartEquity(db, addr, dayKey, equity);
    return { ok: true };
  }

  const loss = dayStart.equity - params.equity.equity;
  if (Number.isFinite(loss) && loss >= cap) {
    return { skipReason: "max_daily_loss_exceeded" };
  }
  return { ok: true };
}

export async function checkMaxSlippage(params: {
  client: ClobClient;
  tokenId: string;
  leaderPrice: number;
  side: "BUY" | "SELL";
  maxSlippageBps: number | null;
}): Promise<{ ok: true; referencePrice: number } | { skipReason: string }> {
  const bps = params.maxSlippageBps ?? 150;
  if (!Number.isFinite(bps) || bps <= 0) return { ok: true, referencePrice: params.leaderPrice };

  try {
    const midRaw = await params.client.getMidpoint(params.tokenId);
    const mid =
      typeof midRaw === "number"
        ? midRaw
        : typeof midRaw === "string"
          ? Number(midRaw)
          : Number((midRaw as { mid?: string })?.mid);
    if (!Number.isFinite(mid) || mid <= 0) {
      return { skipReason: "slippage_mid_unavailable" };
    }

    const ref = params.leaderPrice;
    const diffBps = (Math.abs(mid - ref) / ref) * 10_000;
    if (diffBps > bps) {
      return { skipReason: "max_slippage_exceeded" };
    }
    return { ok: true, referencePrice: mid };
  } catch {
    return { skipReason: "slippage_check_failed" };
  }
}
