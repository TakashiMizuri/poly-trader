import type { ChartCandle } from '@/types/candle'

/** Polymarket default art for BTC Up/Down 5m series. */
export const BTC_5M_MARKET_IMAGE_URL =
  'https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png'

/** Max candles kept in memory and shown on the chart (Binance page size). */
export const MARKET_DATA_MAX_CANDLES = 1000

/** UTC — optional floor for live merge (legacy). */
export const MARKET_DATA_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0)
export const MARKET_DATA_START_SEC = Math.floor(MARKET_DATA_START_MS / 1000)

/** Most recent {@link MARKET_DATA_MAX_CANDLES} bars for the live chart. */
export function lastMarketDataCandles(
  candles: ChartCandle[],
  maxCount: number = MARKET_DATA_MAX_CANDLES,
): ChartCandle[] {
  if (candles.length <= maxCount) {
    return candles
  }
  return candles.slice(-maxCount)
}

/** @deprecated Prefer {@link lastMarketDataCandles}. */
export function candlesSinceMarketDataStart(candles: ChartCandle[]): ChartCandle[] {
  if (candles.length === 0) {
    return candles
  }
  const startIndex = candles.findIndex((c) => c.time >= MARKET_DATA_START_SEC)
  const fromStart = startIndex === -1 ? [] : candles.slice(startIndex)
  return lastMarketDataCandles(fromStart)
}
