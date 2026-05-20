import type { ChartCandle } from '@/types/candle';
import type { TrendBetStrategyParams } from '@/types/trendBetStrategy';
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure';

export function countBarsSinceFlipAtOpen(
	bosFlipAt: boolean[],
	index: number,
): number {
	let count = 0;
	for (let j = index - 1; j >= 0; j--) {
		if (bosFlipAt[j]) {
			break;
		}
		count++;
	}
	return count;
}

function referenceLow(
	candles: ChartCandle[],
	index: number,
	lookback: number,
): number {
	let ref = Infinity;
	for (let k = Math.max(0, index - lookback); k < index; k++) {
		ref = Math.min(ref, candles[k].low);
	}
	return ref;
}

function referenceHigh(
	candles: ChartCandle[],
	index: number,
	lookback: number,
): number {
	let ref = -Infinity;
	for (let k = Math.max(0, index - lookback); k < index; k++) {
		ref = Math.max(ref, candles[k].high);
	}
	return ref;
}

/** Distance from open to structure break level (positive = safe side). */
export function distanceFromStructureAtOpen(
	candles: ChartCandle[],
	index: number,
	trend: MarketTrend,
	structureLookback: number,
): number {
	const open = candles[index].open;
	if (trend === 'long') {
		return open - referenceLow(candles, index, structureLookback);
	}
	return referenceHigh(candles, index, structureLookback) - open;
}

/**
 * Whether to open a bet at the start of bar `index`.
 * Uses only prior-bar BoS flags, structure levels, and this bar's open.
 */
export function shouldPlaceTrendBetAtOpen(
	index: number,
	candles: ChartCandle[],
	trendAtOpen: MarketTrend[],
	bosFlipAt: boolean[],
	params: TrendBetStrategyParams,
): boolean {
	const lookback = Math.max(1, Math.floor(params.structureLookback));
	const barsSinceFlip = countBarsSinceFlipAtOpen(bosFlipAt, index);

	if (params.minBarsSinceFlip > 0 && barsSinceFlip < params.minBarsSinceFlip) {
		return false;
	}
	if (params.maxBarsSinceFlip > 0 && barsSinceFlip > params.maxBarsSinceFlip) {
		return false;
	}

	if (params.minDistanceFromStructure > 0) {
		const distance = distanceFromStructureAtOpen(
			candles,
			index,
			trendAtOpen[index],
			lookback,
		);
		if (distance < params.minDistanceFromStructure) {
			return false;
		}
	}

	return true;
}
