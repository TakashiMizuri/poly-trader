import type { ChartCandle } from '@/types/candle'

const PREFIX = 'poly-trader-candles:'

function cacheKey(symbol: string, interval: string): string {
  return `${PREFIX}${symbol}:${interval}`
}

export function readCandleCache(
  symbol: string,
  interval: string,
): ChartCandle[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(symbol, interval))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ChartCandle[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export function writeCandleCache(
  symbol: string,
  interval: string,
  candles: ChartCandle[],
): void {
  if (candles.length === 0) return
  try {
    sessionStorage.setItem(
      cacheKey(symbol, interval),
      JSON.stringify(candles),
    )
  } catch {
    /* ignore quota / private mode */
  }
}
