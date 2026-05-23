import { useCallback, useEffect, useRef, useState } from 'react';

import {
	lastMarketDataCandles,
	MARKET_DATA_MAX_CANDLES,
} from '@/constants/marketData';
import {
	readCandleCache,
	writeCandleCache,
} from '@/lib/candleCache';
import type { ChartCandle } from '@/types/candle';
import {
	fetchBinanceKlines,
	getBinanceCombinedStreamUrl,
	getBinanceKlineStreamUrl,
	getBinanceTradeStreamName,
	mergeKlineUpdate,
	patchFormingCandleWithPrice,
	wsKlineToChartCandle,
	type BinanceConnectionStatus,
	type BinanceKlineInterval,
	type BinanceKlineWsPayload,
	type BinanceTradeWsPayload,
} from '@/services/binanceMarketService';

const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_INTERVAL: BinanceKlineInterval = '5m';
const DEFAULT_HISTORY_LIMIT = MARKET_DATA_MAX_CANDLES;
const DEFAULT_LIVE_REFRESH_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface UseBinanceLiveCandlesOptions {
	symbol?: string;
	interval?: BinanceKlineInterval;
	/** How many recent closed bars to load on connect (default: 1000). */
	historyLimit?: number;
	/** Poll latest trade into the forming bar (e.g. every 1s on 5m). */
	liveRefreshMs?: number;
	enabled?: boolean;
}

export function useBinanceLiveCandles(
	options: UseBinanceLiveCandlesOptions = {},
) {
	const {
		symbol = DEFAULT_SYMBOL,
		interval = DEFAULT_INTERVAL,
		historyLimit = DEFAULT_HISTORY_LIMIT,
		liveRefreshMs = DEFAULT_LIVE_REFRESH_MS,
		enabled = true,
	} = options;

	const [candles, setCandles] = useState<ChartCandle[]>(
		() => readCandleCache(symbol, interval) ?? [],
	);
	const [status, setStatus] = useState<BinanceConnectionStatus>(() =>
		readCandleCache(symbol, interval)?.length ? 'connected' : 'idle',
	);
	const [error, setError] = useState<string | null>(null);
	const [lastPrice, setLastPrice] = useState<number | null>(null);
	const [lastEventTime, setLastEventTime] = useState<number | null>(null);

	const reconnectAttemptRef = useRef(0);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const wsRef = useRef<WebSocket | null>(null);
	const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const latestTradePriceRef = useRef<number | null>(null);
	const intentionalCloseRef = useRef(false);
	const disposedRef = useRef(false);

	const useTradeTick =
		liveRefreshMs > 0 && interval !== '1s';

	const clearReconnectTimer = useCallback(() => {
		if (reconnectTimerRef.current != null) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
	}, []);

	const clearTickTimer = useCallback(() => {
		if (tickTimerRef.current != null) {
			clearInterval(tickTimerRef.current);
			tickTimerRef.current = null;
		}
	}, []);

	const closeSocket = useCallback(() => {
		const ws = wsRef.current;
		wsRef.current = null;
		if (ws) {
			intentionalCloseRef.current = true;
			ws.onopen = null;
			ws.onmessage = null;
			ws.onerror = null;
			ws.onclose = null;
			if (
				ws.readyState === WebSocket.OPEN ||
				ws.readyState === WebSocket.CONNECTING
			) {
				ws.close();
			}
		}
	}, []);

	const applyKline = useCallback(
		(candle: ChartCandle) => {
			setCandles((prev) =>
				lastMarketDataCandles(mergeKlineUpdate(prev, candle), historyLimit),
			);
			setLastPrice(candle.close);
			setLastEventTime(Date.now());
			latestTradePriceRef.current = candle.close;
		},
		[historyLimit],
	);

	const applyTradePrice = useCallback((price: number) => {
		latestTradePriceRef.current = price;
		setLastPrice(price);
	}, []);

	const flushTradeIntoFormingBar = useCallback(() => {
		const price = latestTradePriceRef.current;
		if (price == null || !Number.isFinite(price)) return;

		setCandles((prev) => {
			const patched = patchFormingCandleWithPrice(prev, price);
			if (!patched) return prev;
			setLastEventTime(Date.now());
			return patched;
		});
	}, []);

	const scheduleReconnect = useCallback(
		(connect: () => void) => {
			if (disposedRef.current) return;
			clearReconnectTimer();
			const attempt = reconnectAttemptRef.current;
			const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
			reconnectAttemptRef.current = attempt + 1;
			setStatus('reconnecting');
			reconnectTimerRef.current = setTimeout(() => {
				if (!disposedRef.current) {
					connect();
				}
			}, delay);
		},
		[clearReconnectTimer],
	);

	useEffect(() => {
		disposedRef.current = false;

		if (!enabled) {
			closeSocket();
			clearReconnectTimer();
			clearTickTimer();
			setStatus('idle');
			return;
		}

		let cancelled = false;

		const startTickTimer = () => {
			clearTickTimer();
			if (!useTradeTick) return;
			tickTimerRef.current = setInterval(() => {
				if (!cancelled && !disposedRef.current) {
					flushTradeIntoFormingBar();
				}
			}, liveRefreshMs);
		};

		const connectWs = () => {
			if (cancelled || disposedRef.current) return;

			closeSocket();
			intentionalCloseRef.current = false;
			const klineStreamName = `${symbol.toLowerCase()}@kline_${interval}`;
			const url = useTradeTick
				? getBinanceCombinedStreamUrl([
						klineStreamName,
						getBinanceTradeStreamName(symbol),
					])
				: getBinanceKlineStreamUrl(symbol, interval);

			const ws = new WebSocket(url);
			wsRef.current = ws;

			ws.onopen = () => {
				if (cancelled) return;
				reconnectAttemptRef.current = 0;
				setStatus('connected');
				setError(null);
				startTickTimer();
			};

			ws.onmessage = (event) => {
				if (cancelled) return;
				try {
					const raw = JSON.parse(event.data as string) as
						| BinanceKlineWsPayload
						| { stream?: string; data?: BinanceKlineWsPayload | BinanceTradeWsPayload };

					const payload =
						raw && typeof raw === 'object' && 'data' in raw && raw.data
							? raw.data
							: raw;

					if (
						payload &&
						typeof payload === 'object' &&
						'e' in payload &&
						payload.e === 'kline' &&
						'k' in payload &&
						payload.k
					) {
						applyKline(wsKlineToChartCandle(payload.k));
						return;
					}

					if (
						useTradeTick &&
						payload &&
						typeof payload === 'object' &&
						'e' in payload &&
						payload.e === 'trade' &&
						'p' in payload
					) {
						const price = Number.parseFloat(payload.p as string);
						if (Number.isFinite(price)) {
							applyTradePrice(price);
						}
					}
				} catch {
					// ignore malformed frames
				}
			};

			ws.onclose = (event) => {
				if (cancelled || disposedRef.current) return;
				wsRef.current = null;
				clearTickTimer();

				if (intentionalCloseRef.current) {
					intentionalCloseRef.current = false;
					return;
				}

				if (event.code !== 1000) {
					setError(
						`WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`,
					);
				}
				setStatus('disconnected');
				scheduleReconnect(connectWs);
			};
		};

		const bootstrap = async () => {
			setStatus('loading');
			setError(null);
			try {
				const history = await fetchBinanceKlines(
					symbol,
					interval,
					historyLimit,
				);
				if (cancelled) return;

				const trimmed = lastMarketDataCandles(history, historyLimit);
				setCandles(trimmed);
				writeCandleCache(symbol, interval, trimmed);
				const last = trimmed[trimmed.length - 1];
				if (last) {
					setLastPrice(last.close);
					latestTradePriceRef.current = last.close;
					setLastEventTime(Date.now());
				}
				connectWs();
			} catch (err) {
				if (cancelled) return;
				const message =
					err instanceof Error ? err.message : 'Failed to load Binance data';
				setError(message);
				setStatus('error');
				scheduleReconnect(bootstrap);
			}
		};

		void bootstrap();

		return () => {
			cancelled = true;
			disposedRef.current = true;
			clearReconnectTimer();
			clearTickTimer();
			closeSocket();
		};
	}, [
		symbol,
		interval,
		historyLimit,
		liveRefreshMs,
		useTradeTick,
		enabled,
		applyKline,
		applyTradePrice,
		flushTradeIntoFormingBar,
		closeSocket,
		clearReconnectTimer,
		clearTickTimer,
		scheduleReconnect,
	]);

	useEffect(() => {
		if (candles.length === 0) return;
		const id = globalThis.setTimeout(
			() => writeCandleCache(symbol, interval, candles),
			2_000,
		);
		return () => globalThis.clearTimeout(id);
	}, [candles, symbol, interval]);

	return {
		candles,
		status,
		error,
		lastPrice,
		lastEventTime,
		symbol,
		interval,
	};
}
