import type { ChartCandle } from '@/types/candle';

export type BosDirection = 'bullish' | 'bearish';
export type MarketTrend = 'long' | 'short';

export interface BosLine {
	fromTime: number;
	toTime: number;
	price: number;
	direction: BosDirection;
}

export interface TrendSegment {
	fromTime: number;
	toTime: number;
	trend: MarketTrend;
}

export interface BosAnalysisOptions {
	/** How many prior bars define structure (1 = previous bar only). */
	structureLookback?: number;
	/** Minimum bars in current segment before a flip can register. */
	minSegmentBars?: number;
	/** Minimum bars after a flip before another flip is allowed. */
	minBarsBetweenFlips?: number;
	/** Close must break structure by at least this amount. */
	breakBuffer?: number;
	/** Use candle body (not wick) for break detection. */
	bodyBreakOnly?: boolean;
}

export interface BosAnalysis {
	lines: BosLine[];
	segments: TrendSegment[];
	/** Trend active at the open of each candle in the analyzed window. */
	trendAtOpen: MarketTrend[];
	/** True where structure break is confirmed on this bar's close. */
	bosFlipAt: boolean[];
	/** Trend for the next candle's open (after the last candle closes). */
	trendForNextOpen: MarketTrend;
}

function referenceLow(candles: ChartCandle[], index: number, lookback: number): number {
	let ref = Infinity;
	for (let k = Math.max(0, index - lookback); k < index; k++) {
		ref = Math.min(ref, candles[k].low);
	}
	return ref;
}

function referenceHigh(candles: ChartCandle[], index: number, lookback: number): number {
	let ref = -Infinity;
	for (let k = Math.max(0, index - lookback); k < index; k++) {
		ref = Math.max(ref, candles[k].high);
	}
	return ref;
}

function structureBreakPrice(
	candle: ChartCandle,
	trend: MarketTrend,
	bodyBreakOnly: boolean,
): number {
	if (!bodyBreakOnly) {
		return candle.close;
	}
	return trend === 'long'
		? Math.min(candle.open, candle.close)
		: Math.max(candle.open, candle.close);
}

/**
 * Alternating trend + BoS:
 * - Long: close (or body) below min low of prior bars → bearish BoS → short.
 * - Short: close above max high of prior bars → bullish BoS → long.
 */
export function analyzeTrendAndBos(
	candles: ChartCandle[],
	options: BosAnalysisOptions = {},
): BosAnalysis {
	if (candles.length === 0) {
		return {
			lines: [],
			segments: [],
			trendAtOpen: [],
			bosFlipAt: [],
			trendForNextOpen: 'long',
		};
	}

	const lookback = Math.max(1, Math.floor(options.structureLookback ?? 1));
	const minSegmentBars = Math.max(0, Math.floor(options.minSegmentBars ?? 0));
	const minBarsBetweenFlips = Math.max(
		0,
		Math.floor(options.minBarsBetweenFlips ?? 0),
	);
	const breakBuffer = Math.max(0, options.breakBuffer ?? 0);
	const bodyBreakOnly = options.bodyBreakOnly ?? false;

	const lines: BosLine[] = [];
	const segments: TrendSegment[] = [];
	const trendAtOpen: MarketTrend[] = [];
	const bosFlipAt: boolean[] = [];

	let trend: MarketTrend = 'long';
	let barsInSegment = 0;
	let barsSinceLastFlip = Number.MAX_SAFE_INTEGER;
	trendAtOpen.push(trend);
	bosFlipAt.push(false);
	let segmentFromTime = candles[0].time;

	const closeSegment = (toTime: number) => {
		segments.push({
			fromTime: segmentFromTime,
			toTime,
			trend,
		});
		segmentFromTime = toTime;
	};

	const canFlip = () =>
		barsInSegment >= minSegmentBars &&
		barsSinceLastFlip >= minBarsBetweenFlips;

	for (let i = 1; i < candles.length; i++) {
		const candle = candles[i];
		trendAtOpen.push(trend);
		bosFlipAt.push(false);
		barsInSegment++;
		barsSinceLastFlip++;

		if (trend === 'long') {
			const refLow = referenceLow(candles, i, lookback);
			const breakPrice = structureBreakPrice(candle, 'long', bodyBreakOnly);
			if (canFlip() && breakPrice < refLow - breakBuffer) {
				closeSegment(candle.time);
				const fromIdx = Math.max(0, i - lookback);
				let refTime = candles[fromIdx].time;
				let refPrice = candles[fromIdx].low;
				for (let k = fromIdx + 1; k < i; k++) {
					if (candles[k].low <= refPrice) {
						refPrice = candles[k].low;
						refTime = candles[k].time;
					}
				}
				lines.push({
					fromTime: refTime,
					toTime: candle.time,
					price: refPrice,
					direction: 'bearish',
				});
				bosFlipAt[i] = true;
				trend = 'short';
				barsInSegment = 0;
				barsSinceLastFlip = 0;
				continue;
			}
		} else {
			const refHigh = referenceHigh(candles, i, lookback);
			const breakPrice = structureBreakPrice(candle, 'short', bodyBreakOnly);
			if (canFlip() && breakPrice > refHigh + breakBuffer) {
				closeSegment(candle.time);
				const fromIdx = Math.max(0, i - lookback);
				let refTime = candles[fromIdx].time;
				let refPrice = candles[fromIdx].high;
				for (let k = fromIdx + 1; k < i; k++) {
					if (candles[k].high >= refPrice) {
						refPrice = candles[k].high;
						refTime = candles[k].time;
					}
				}
				lines.push({
					fromTime: refTime,
					toTime: candle.time,
					price: refPrice,
					direction: 'bullish',
				});
				bosFlipAt[i] = true;
				trend = 'long';
				barsInSegment = 0;
				barsSinceLastFlip = 0;
				continue;
			}
		}
	}

	segments.push({
		fromTime: segmentFromTime,
		toTime: candles[candles.length - 1].time,
		trend,
	});

	return {
		lines,
		segments,
		trendAtOpen,
		bosFlipAt,
		trendForNextOpen: trend,
	};
}

/** Map strategy params to BoS analysis options. */
export function bosOptionsFromStrategyParams(params: {
	structureLookback: number;
	bosMinSegmentBars: number;
	bosMinBarsBetweenFlips: number;
	bosBreakBuffer: number;
	bosBodyBreakOnly: boolean;
}): BosAnalysisOptions {
	return {
		structureLookback: params.structureLookback,
		minSegmentBars: params.bosMinSegmentBars,
		minBarsBetweenFlips: params.bosMinBarsBetweenFlips,
		breakBuffer: params.bosBreakBuffer,
		bodyBreakOnly: params.bosBodyBreakOnly,
	};
}

/** @deprecated Use {@link analyzeTrendAndBos} */
export function detectBreakOfStructure(candles: ChartCandle[]): BosLine[] {
	return analyzeTrendAndBos(candles).lines;
}

/** @deprecated Use {@link analyzeTrendAndBos} */
export function getBosFlipBarTimes(lines: BosLine[]): ReadonlySet<number> {
	return new Set(lines.map((line) => line.toTime));
}

/** @deprecated Chart overlay only; blend_fade2 uses separate signal path. */
export function bosOptionsFromTrendBetParams(
	params?: Partial<{
		structureLookback: number
		bosMinSegmentBars: number
		bosMinBarsBetweenFlips: number
		bosBreakBuffer: number
		bosBodyBreakOnly: boolean
	}>,
): BosAnalysisOptions {
	return bosOptionsFromStrategyParams({
		structureLookback: params?.structureLookback ?? 5,
		bosMinSegmentBars: params?.bosMinSegmentBars ?? 0,
		bosMinBarsBetweenFlips: params?.bosMinBarsBetweenFlips ?? 0,
		bosBreakBuffer: params?.bosBreakBuffer ?? 0,
		bosBodyBreakOnly: params?.bosBodyBreakOnly ?? false,
	});
}
