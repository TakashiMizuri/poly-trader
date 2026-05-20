import type { ChartCandle } from '@/types/candle';
import type { TrendBetStrategyParams } from '@/types/trendBetStrategy';
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure';
import { predictExhaustionFadeAtOpen } from '@/utils/chart/predictCandleDirectionAtOpen';

/**
 * Bet side at bar open (long = expect close > open). Null = no bet this bar.
 *
 * Causal at index `i` (no lookahead on bar `i`):
 * - `trendAtOpen[i]` — BoS state before bar `i` closes (from bars `0..i-1` only).
 * - Exhaustion uses OHLC of bars `i-N..i-1` only (already closed).
 * - Does not use `candles[i].high`, `candles[i].low`, or `candles[i].close`.
 * - `candles[i].open` is allowed at open but is not used by exhaustion fade.
 */
export function resolveBetAtOpen(
	index: number,
	candles: ChartCandle[],
	trendAtOpen: MarketTrend[],
	params: TrendBetStrategyParams,
): MarketTrend | null {
	const lookback = Math.max(1, Math.floor(params.structureLookback));
	const n = Math.max(2, Math.floor(params.exhaustionConsecutiveBars));
	const signal = predictExhaustionFadeAtOpen(
		index,
		candles,
		trendAtOpen,
		{
			structureLookback: lookback,
			warmupBars: lookback,
			consecutiveBars: n,
		},
	);
	return signal.bet;
}

/** After bar `candles.length - 1` closes: signal for the next bar open (live engine). */
export function resolveBetForUpcomingBar(
	candles: ChartCandle[],
	trendAtOpen: MarketTrend[],
	trendForNextOpen: MarketTrend,
	params: TrendBetStrategyParams,
): MarketTrend | null {
	const nextIndex = candles.length;
	const extendedTrend: MarketTrend[] = [...trendAtOpen, trendForNextOpen];
	return resolveBetAtOpen(nextIndex, candles, extendedTrend, params);
}
