import type { ChartCandle } from '@/types/candle'
import type { TrendBetStrategyParams } from '@/types/trendBetStrategy'
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure'
import { resolveBlendFade2AtOpen } from '@/utils/chart/blendFade2Signals'

/**
 * Bet side at bar open (long = expect close > open). Null = no bet this bar.
 * blend_fade2: decision at open[i] using only bars [0..i-1] (+ session on open time).
 */
export function resolveBetAtOpen(
  index: number,
  candles: ChartCandle[],
  _trendAtOpen: MarketTrend[],
  params: TrendBetStrategyParams,
): MarketTrend | null {
  return resolveBlendFade2AtOpen(index, candles, params.blendFade2)
}

/** After bar `candles.length - 1` closes: signal for the next bar open (live engine). */
export function resolveBetForUpcomingBar(
  candles: ChartCandle[],
  _trendAtOpen: MarketTrend[],
  _trendForNextOpen: MarketTrend,
  params: TrendBetStrategyParams,
  nextBarOpenTimeMs: number,
): MarketTrend | null {
  return resolveBlendFade2AtOpen(
    candles.length,
    candles,
    params.blendFade2,
    nextBarOpenTimeMs,
  )
}
