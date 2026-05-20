import type { ChartCandle } from '@/types/candle'
import type { TrendBetStrategyParams } from '@/types/trendBetStrategy'
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure'
import { resolveBosFlowAtOpen } from '@/utils/chart/bosFlowSignals'

/**
 * Bet side at bar open (long = expect close > open). Null = no bet this bar.
 * BoS flow: decision at open[i] using only bars [0..i-1] (+ session on open time).
 */
export function resolveBetAtOpen(
  index: number,
  candles: ChartCandle[],
  _trendAtOpen: MarketTrend[],
  params: TrendBetStrategyParams,
): MarketTrend | null {
  return resolveBosFlowAtOpen(index, candles, params.bosFlow)
}

/** After bar `candles.length - 1` closes: signal for the next bar open (live engine). */
export function resolveBetForUpcomingBar(
  candles: ChartCandle[],
  _trendAtOpen: MarketTrend[],
  _trendForNextOpen: MarketTrend,
  params: TrendBetStrategyParams,
  nextBarOpenTimeMs: number,
): MarketTrend | null {
  return resolveBosFlowAtOpen(
    candles.length,
    candles,
    params.bosFlow,
    nextBarOpenTimeMs,
  )
}
