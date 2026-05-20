import type { ChartCandle } from '@/types/candle';
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure';

export type CandleDirectionBet = 'long' | 'short';

export type CandleDirectionSignal =
	| { bet: CandleDirectionBet }
	| { bet: null; reason: 'warmup' | 'no_signal' };

export interface ExhaustionFadeOptions {
	structureLookback?: number;
	/** Bars required before first bet (>= structureLookback). */
	warmupBars?: number;
	/** Consecutive same-color bars required against trend. */
	consecutiveBars?: number;
}

/**
 * Fade after N consecutive **closed** bars with the trend (exhaustion).
 * Uses bars `index-N..index-1` OHLC and `trendAtOpen[index]` only — not bar `index`.
 */
export function predictExhaustionFadeAtOpen(
	index: number,
	candles: ChartCandle[],
	trendAtOpen: MarketTrend[],
	options: ExhaustionFadeOptions = {},
): CandleDirectionSignal {
	const n = options.consecutiveBars ?? 3;
	const warmup = Math.max(
		options.warmupBars ?? 5,
		n,
		options.structureLookback ?? 5,
	);
	if (index < warmup) {
		return { bet: null, reason: 'warmup' };
	}
	const trend = trendAtOpen[index];
	const isBull = (j: number) => candles[j].close > candles[j].open;
	const isBear = (j: number) => candles[j].close < candles[j].open;
	const allBull = Array.from({ length: n }, (_, k) => index - 1 - k).every(isBull);
	const allBear = Array.from({ length: n }, (_, k) => index - 1 - k).every(isBear);
	if (trend === 'long' && allBull) {
		return { bet: 'short' };
	}
	if (trend === 'short' && allBear) {
		return { bet: 'long' };
	}
	return { bet: null, reason: 'no_signal' };
}

export function isCandleDirectionBetWon(
	bet: CandleDirectionBet,
	candle: ChartCandle,
): boolean {
	return bet === 'long'
		? candle.close > candle.open
		: candle.close < candle.open;
}
