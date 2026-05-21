import type { ChartCandle } from '@/types/candle'
import {
  DEFAULT_BLEND_FADE2_CONFIG,
  type BlendFade2Config,
} from '@/types/blendFade2Config'
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure'

export interface BlendFade2SignalArrays {
  entryBar: boolean[]
  side: (MarketTrend | null)[]
}

function sessionOk(openTimeUnix: number, cfg: BlendFade2Config): boolean {
  const start = cfg.sessionUtcStart
  const end = cfg.sessionUtcEnd
  if (start === null || end === null) return true
  const hour =
    openTimeUnix > 1_000_000_000_000
      ? Math.floor((openTimeUnix / 1000 / 3600) % 24)
      : Math.floor((openTimeUnix / 3600) % 24)
  if (start <= end) return hour >= start && hour < end
  return hour >= start || hour < end
}

function zScore(values: number[], endIdx: number, lookback: number): number | null {
  const start = endIdx - lookback
  if (start < 0) return null
  let sum = 0
  for (let i = start; i < endIdx; i++) sum += values[i]
  const mu = sum / lookback
  let varSum = 0
  for (let i = start; i < endIdx; i++) {
    const d = values[i] - mu
    varSum += d * d
  }
  const std = Math.sqrt(varSum / lookback)
  if (std <= 0) return null
  return (values[endIdx] - mu) / std
}

function percentileRank(closes: number[], endIdx: number, lookback: number): number | null {
  const start = endIdx - lookback
  if (start < 0) return null
  let lo = closes[start]
  let hi = closes[start]
  for (let i = start; i <= endIdx; i++) {
    lo = Math.min(lo, closes[i])
    hi = Math.max(hi, closes[i])
  }
  const span = hi - lo
  if (span <= 0) return null
  return (closes[endIdx] - lo) / span
}

/** 1:1 with trading-cursor-models strategies/blend_fade2/signals.py */
export function generateBlendFade2Signals(
  candles: ChartCandle[],
  config: BlendFade2Config = DEFAULT_BLEND_FADE2_CONFIG,
): BlendFade2SignalArrays {
  const n = candles.length
  const entryBar: boolean[] = Array(n).fill(false)
  const side: (MarketTrend | null)[] = Array(n).fill(null)

  const closes = candles.map((c) => c.close)
  const openTimes = candles.map((c) => c.time)

  const lb = config.lookback
  const lbF = config.lookbackFast
  const zTh = config.zThreshold

  for (let i = 1; i < n; i++) {
    if (!sessionOk(openTimes[i], config)) continue

    const closed = i - 1
    if (closed < Math.max(lb, lbF) + 1) continue

    const z = zScore(closes, closed, lb)
    if (z === null) continue

    if (config.minRangePct > 0 && closed >= lb) {
      const windowStart = closed - lb
      const ref = closes[windowStart]
      if (ref > 0) {
        let windowMax = closes[windowStart]
        let windowMin = closes[windowStart]
        for (let j = windowStart; j <= closed; j++) {
          windowMax = Math.max(windowMax, closes[j])
          windowMin = Math.min(windowMin, closes[j])
        }
        const move = (windowMax - windowMin) / ref
        if (move < config.minRangePct) continue
      }
    }

    let signalSide: 'long' | 'short' | null = null
    if (z > zTh) signalSide = 'short'
    else if (z < -zTh) signalSide = 'long'
    if (signalSide === null) continue

    if (config.zMax > 0) {
      if (signalSide === 'short' && z > config.zMax) continue
      if (signalSide === 'long' && z < -config.zMax) continue
    }

    if (config.zReversal) {
      const zPrev = zScore(closes, closed - 1, lb)
      if (zPrev === null) continue
      if (signalSide === 'short' && z >= zPrev) continue
      if (signalSide === 'long' && z <= zPrev) continue
    }

    if (config.zFastMin > 0) {
      const zFast = zScore(closes, closed, lbF)
      if (zFast === null) continue
      if (signalSide === 'short' && zFast < config.zFastMin) continue
      if (signalSide === 'long' && zFast > -config.zFastMin) continue
    }

    if (config.rankConfirm > 0) {
      const rank = percentileRank(closes, closed, lb)
      if (rank === null) continue
      if (signalSide === 'short' && rank < config.rankConfirm) continue
      if (signalSide === 'long' && rank > 1.0 - config.rankConfirm) continue
    }

    entryBar[i] = true
    side[i] = signalSide
  }

  return { entryBar, side }
}

export function resolveBlendFade2AtOpen(
  index: number,
  candles: ChartCandle[],
  config: BlendFade2Config = DEFAULT_BLEND_FADE2_CONFIG,
  nextBarOpenTimeMs?: number,
): MarketTrend | null {
  if (index < 0) return null

  if (index < candles.length) {
    const signals = generateBlendFade2Signals(candles, config)
    return signals.entryBar[index] ? signals.side[index] : null
  }

  if (nextBarOpenTimeMs === undefined || candles.length === 0) return null

  const anchor = candles[candles.length - 1]
  const extended: ChartCandle[] = [
    ...candles,
    {
      time: nextBarOpenTimeMs,
      open: anchor.close,
      high: anchor.close,
      low: anchor.close,
      close: anchor.close,
    },
  ]
  const signals = generateBlendFade2Signals(extended, config)
  return signals.entryBar[index] ? signals.side[index] : null
}
