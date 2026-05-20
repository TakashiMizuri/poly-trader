import type { CandlestickData, Time, WhitespaceData } from 'lightweight-charts'
import type { ChartCandle } from '@/types/candle'
import type { Timeframe } from '@/types/timeframe'

export type CandleOrWhitespacePoint = CandlestickData<Time> | WhitespaceData<Time>

export const TIMEFRAME_BAR_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  D: 86400,
  W: 604800,
}

const FUTURE_HISTORY_FRACTION: Record<Timeframe, number> = {
  '1m': 0.2,
  '5m': 0.24,
  '15m': 0.28,
  '30m': 0.3,
  '1h': 0.34,
  '4h': 0.38,
  D: 0.5,
  W: 0.58,
}

const DEFAULT_FUTURE_HISTORY_FRACTION = 0.32
const MAX_AXIS_FUTURE_SEC = 12 * 365 * 86400
const TRAILING_WHITESPACE_BARS_CAP = 2000

const INITIAL_VISIBLE_BARS: Record<Timeframe, number> = {
  '1m': 480,
  '5m': 480,
  '15m': 400,
  '30m': 190,
  '1h': 180,
  '4h': 160,
  D: 130,
  W: 85,
}

const INITIAL_VISIBLE_BARS_DEFAULT = 200

export function getInitialVisibleBarCount(timeframe: Timeframe | undefined): number {
  if (timeframe && INITIAL_VISIBLE_BARS[timeframe] !== undefined) {
    return INITIAL_VISIBLE_BARS[timeframe]
  }
  return INITIAL_VISIBLE_BARS_DEFAULT
}

function trailingWhitespaceBarCount(
  candles: ChartCandle[],
  timeframe: Timeframe | undefined,
): number {
  if (candles.length < 2) {
    const barSec = timeframe ? TIMEFRAME_BAR_SECONDS[timeframe] : 3600
    const approx = Math.ceil((200 * 86400) / barSec)
    return Math.min(TRAILING_WHITESPACE_BARS_CAP, Math.max(48, approx))
  }

  const t0 = candles[0].time
  const t1 = candles[candles.length - 1].time
  const barSec = timeframe
    ? TIMEFRAME_BAR_SECONDS[timeframe]
    : Math.max(30, candles[candles.length - 1].time - candles[candles.length - 2].time)
  const historySec = Math.max(barSec * 4, t1 - t0)
  const frac = timeframe
    ? FUTURE_HISTORY_FRACTION[timeframe]
    : DEFAULT_FUTURE_HISTORY_FRACTION
  const futureSec = Math.min(historySec * frac, MAX_AXIS_FUTURE_SEC)
  return Math.min(
    TRAILING_WHITESPACE_BARS_CAP,
    Math.max(48, Math.ceil(futureSec / barSec)),
  )
}

function whitespaceStepSeconds(
  candles: ChartCandle[],
  timeframe: Timeframe | undefined,
): number {
  if (timeframe) return TIMEFRAME_BAR_SECONDS[timeframe]
  if (candles.length >= 2) {
    return Math.max(30, candles[candles.length - 1].time - candles[candles.length - 2].time)
  }
  return 3600
}

function firstFutureGridTime(lastSec: number, stepSec: number): number {
  let t = Math.floor(lastSec / stepSec) * stepSec + stepSec
  while (t <= lastSec) t += stepSec
  return t
}

export function buildSeriesDataWithFutureWhitespace(
  candles: ChartCandle[],
  timeframe: Timeframe | undefined,
): CandleOrWhitespacePoint[] {
  if (candles.length === 0) return []

  const ohlc: CandlestickData<Time>[] = candles.map((c) => ({
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))

  const stepSec = whitespaceStepSeconds(candles, timeframe)
  const count = trailingWhitespaceBarCount(candles, timeframe)
  const lastT = candles[candles.length - 1].time
  const startT = firstFutureGridTime(lastT, stepSec)
  const trailing: WhitespaceData<Time>[] = []
  for (let i = 0; i < count; i++) {
    trailing.push({ time: (startT + i * stepSec) as Time })
  }
  return [...ohlc, ...trailing]
}
