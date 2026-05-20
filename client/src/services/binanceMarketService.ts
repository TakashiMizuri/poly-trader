import type { ChartCandle } from '@/types/candle';

const BINANCE_REST_BASE = 'https://api.binance.com';
/** Single raw stream: /ws/{streamName} */
const BINANCE_WS_SINGLE = 'wss://stream.binance.com:9443/ws';
/** Combined streams: /stream?streams=... (not under /ws) */
const BINANCE_WS_COMBINED = 'wss://stream.binance.com:9443';

export type BinanceKlineInterval = '1s' | '1m' | '5m' | '15m' | '1h';

export type BinanceConnectionStatus =
	| 'idle'
	| 'loading'
	| 'connected'
	| 'reconnecting'
	| 'disconnected'
	| 'error';

/** Raw kline array from GET /api/v3/klines */
type BinanceKlineRow = [
	number,
	string,
	string,
	string,
	string,
	string,
	number,
	string,
	number,
	string,
	string,
	string,
];

export interface BinanceKlineWsPayload {
	e: 'kline';
	E: number;
	s: string;
	k: {
		t: number;
		T: number;
		s: string;
		i: string;
		o: string;
		c: string;
		h: string;
		l: string;
		v: string;
		n: number;
		x: boolean;
	};
}

function rowToChartCandle(row: BinanceKlineRow): ChartCandle {
	return {
		time: Math.floor(row[0] / 1000),
		open: Number.parseFloat(row[1]),
		high: Number.parseFloat(row[2]),
		low: Number.parseFloat(row[3]),
		close: Number.parseFloat(row[4]),
	};
}

export function wsKlineToChartCandle(k: BinanceKlineWsPayload['k']): ChartCandle {
	return {
		time: Math.floor(k.t / 1000),
		open: Number.parseFloat(k.o),
		high: Number.parseFloat(k.h),
		low: Number.parseFloat(k.l),
		close: Number.parseFloat(k.c),
	};
}

export interface BinanceTradeWsPayload {
	e: 'trade';
	p: string;
}

export function getBinanceKlineStreamUrl(
	symbol: string,
	interval: BinanceKlineInterval,
): string {
	const stream = `${symbol.toLowerCase()}@kline_${interval}`;
	return `${BINANCE_WS_SINGLE}/${stream}`;
}

export function getBinanceTradeStreamName(symbol: string): string {
	return `${symbol.toLowerCase()}@trade`;
}

/** Combined stream: kline + trades on one WebSocket. */
export function getBinanceCombinedStreamUrl(streams: string[]): string {
	const path = streams.map((s) => s.toLowerCase()).join('/');
	return `${BINANCE_WS_COMBINED}/stream?streams=${path}`;
}

/** Update the open 5m (or any TF) candle with the latest trade price. */
export function patchFormingCandleWithPrice(
	candles: ChartCandle[],
	price: number,
): ChartCandle[] | null {
	if (candles.length === 0 || !Number.isFinite(price)) {
		return null;
	}

	const last = candles[candles.length - 1];
	const updated: ChartCandle = {
		...last,
		close: price,
		high: Math.max(last.high, price),
		low: Math.min(last.low, price),
	};

	if (
		updated.close === last.close &&
		updated.high === last.high &&
		updated.low === last.low
	) {
		return null;
	}

	return candles.slice(0, -1).concat(updated);
}

const BINANCE_KLINES_PAGE_SIZE = 1000;

async function fetchBinanceKlinesPage(
	symbol: string,
	interval: BinanceKlineInterval,
	limit: number,
	endTimeMs?: number,
): Promise<ChartCandle[]> {
	const params = new URLSearchParams({
		symbol: symbol.toUpperCase(),
		interval,
		limit: String(Math.min(BINANCE_KLINES_PAGE_SIZE, Math.max(1, limit))),
	});
	if (endTimeMs != null) {
		params.set('endTime', String(endTimeMs));
	}

	const response = await fetch(
		`${BINANCE_REST_BASE}/api/v3/klines?${params.toString()}`,
	);
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(
			`Binance klines failed (${response.status})${body ? `: ${body}` : ''}`,
		);
	}

	const rows = (await response.json()) as BinanceKlineRow[];
	return rows.map(rowToChartCandle);
}

/** Loads up to `limit` most recent candles (paginates when limit > 1000). */
export async function fetchBinanceKlines(
	symbol: string,
	interval: BinanceKlineInterval,
	limit: number,
): Promise<ChartCandle[]> {
	const target = Math.max(1, limit);
	const merged: ChartCandle[] = [];
	let endTimeMs: number | undefined;

	while (merged.length < target) {
		const batchLimit = Math.min(
			BINANCE_KLINES_PAGE_SIZE,
			target - merged.length,
		);
		const batch = await fetchBinanceKlinesPage(
			symbol,
			interval,
			batchLimit,
			endTimeMs,
		);
		if (batch.length === 0) {
			break;
		}

		merged.unshift(...batch);
		endTimeMs = batch[0].time * 1000 - 1;
		if (batch.length < batchLimit) {
			break;
		}
	}

	return merged.length > target ? merged.slice(-target) : merged;
}

export function mergeKlineUpdate(
	candles: ChartCandle[],
	update: ChartCandle,
	maxCandles: number,
): ChartCandle[] {
	if (candles.length === 0) {
		return [update];
	}

	const last = candles[candles.length - 1];
	if (update.time === last.time) {
		const next = candles.slice(0, -1).concat(update);
		return next.length > maxCandles ? next.slice(-maxCandles) : next;
	}

	if (update.time > last.time) {
		const next = candles.concat(update);
		return next.length > maxCandles ? next.slice(-maxCandles) : next;
	}

	const index = candles.findIndex((c) => c.time === update.time);
	if (index === -1) {
		return candles;
	}
	const next = candles.slice();
	next[index] = update;
	return next;
}
