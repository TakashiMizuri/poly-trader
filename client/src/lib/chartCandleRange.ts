import type { ChartCandle } from '@/types/candle'
import { lastMarketDataCandles } from '@/constants/marketData'
import type { BinanceKlineInterval } from '@/services/binanceMarketService'
import {
  CHART_MAX_CANDLES_MAX,
  CHART_MAX_CANDLES_MIN,
  normalizeMaxCandles,
  type ChartCandleRangeMode,
  type ChartDisplayPrefs,
} from '@/lib/chartDisplayPrefs'

const HOUR_SEC = 3600
const DAY_SEC = 86_400
const WEEK_SEC = 7 * DAY_SEC

const INTERVAL_SEC: Record<BinanceKlineInterval, number> = {
  '1s': 1,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
}

export const CHART_CANDLE_RANGE_LABELS: Record<ChartCandleRangeMode, string> = {
  '1h': 'Last hour',
  '1d': 'Last day',
  '1w': 'Last week',
  fromDate: 'From date',
  count: 'Custom bar count',
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function intervalBarDurationSec(
  interval: BinanceKlineInterval = '5m',
): number {
  return INTERVAL_SEC[interval]
}

/** Earliest candle open time (unix sec) to keep for the current range mode. */
export function chartRangeMinTimeSec(
  prefs: Pick<ChartDisplayPrefs, 'candleRangeMode' | 'candleRangeFromMs'>,
  nowSec = Math.floor(Date.now() / 1000),
): number | null {
  switch (prefs.candleRangeMode) {
    case '1h':
      return nowSec - HOUR_SEC
    case '1d':
      return nowSec - DAY_SEC
    case '1w':
      return nowSec - WEEK_SEC
    case 'fromDate': {
      if (prefs.candleRangeFromMs == null) return null
      return Math.floor(prefs.candleRangeFromMs / 1000)
    }
    case 'count':
      return null
    default:
      return null
  }
}

/** Bars to request from Binance for the selected range (includes a small buffer). */
export function chartRangeHistoryLimit(
  prefs: Pick<
    ChartDisplayPrefs,
    'candleRangeMode' | 'candleRangeFromMs' | 'maxCandles'
  >,
  interval: BinanceKlineInterval = '5m',
  nowMs = Date.now(),
): number {
  if (prefs.candleRangeMode === 'count') {
    return normalizeMaxCandles(prefs.maxCandles)
  }

  const barSec = intervalBarDurationSec(interval)
  let spanSec: number

  switch (prefs.candleRangeMode) {
    case '1h':
      spanSec = HOUR_SEC
      break
    case '1d':
      spanSec = DAY_SEC
      break
    case '1w':
      spanSec = WEEK_SEC
      break
    case 'fromDate': {
      const fromMs = prefs.candleRangeFromMs
      if (fromMs == null || !Number.isFinite(fromMs)) {
        spanSec = DAY_SEC
        break
      }
      spanSec = Math.max(barSec, Math.floor((nowMs - fromMs) / 1000))
      break
    }
    default:
      spanSec = DAY_SEC
  }

  const estimated = Math.ceil(spanSec / barSec) + 5
  return clampInt(estimated, CHART_MAX_CANDLES_MIN, CHART_MAX_CANDLES_MAX)
}

export function filterCandlesForChartRange(
  candles: ChartCandle[],
  prefs: Pick<
    ChartDisplayPrefs,
    'candleRangeMode' | 'candleRangeFromMs' | 'maxCandles'
  >,
  nowSec = Math.floor(Date.now() / 1000),
): ChartCandle[] {
  const minSec = chartRangeMinTimeSec(prefs, nowSec)
  if (minSec != null) {
    const filtered = candles.filter((c) => c.time >= minSec)
    return filtered.length > CHART_MAX_CANDLES_MAX
      ? filtered.slice(-CHART_MAX_CANDLES_MAX)
      : filtered
  }
  return lastMarketDataCandles(candles, normalizeMaxCandles(prefs.maxCandles))
}

export function shouldFetchKlinesSince(
  prefs: Pick<ChartDisplayPrefs, 'candleRangeMode' | 'candleRangeFromMs'>,
): boolean {
  return (
    prefs.candleRangeMode === 'fromDate' &&
    prefs.candleRangeFromMs != null &&
    Number.isFinite(prefs.candleRangeFromMs)
  )
}

/** `datetime-local` value (local timezone) from unix ms. */
export function chartRangeFromMsToDatetimeLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse `datetime-local` input to unix ms (local timezone). */
export function parseChartRangeDatetimeLocal(value: string): number | null {
  if (!value.trim()) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}
