import type { ChartCandle } from '@/types/candle'
import {
  DEFAULT_BOS_FLOW_CONFIG,
  type BosFlowConfig,
} from '@/types/bosFlowConfig'
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure'
import { confirmSwingHigh, confirmSwingLow, ema, rsi } from '@/utils/chart/structureMath'

const MAX_SWINGS = 60

export interface BosFlowSignalArrays {
  entryBar: boolean[]
  side: (MarketTrend | null)[]
}

function sessionOk(openTimeMs: number, cfg: BosFlowConfig): boolean {
  const start = cfg.sessionUtcStart
  const end = cfg.sessionUtcEnd
  if (start === null || end === null) return true
  const hour = Math.floor((openTimeMs / 1000 / 3600) % 24)
  if (start <= end) return hour >= start && hour < end
  return hour >= start || hour < end
}

/** 1:1 with trading-cursor-models strategies/bos_flow/signals.py */
export function generateBosFlowSignals(
  candles: ChartCandle[],
  config: BosFlowConfig = DEFAULT_BOS_FLOW_CONFIG,
): BosFlowSignalArrays {
  const n = candles.length
  const entryBar: boolean[] = Array(n).fill(false)
  const side: (MarketTrend | null)[] = Array(n).fill(null)

  const opens = candles.map((c) => c.open)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)
  const openTimesMs = candles.map((c) => c.time)

  const emaVals = ema(closes, config.emaPeriod)
  const rsiVals = config.useRsiGate
    ? rsi(closes, config.rsiPeriod)
    : Array<(number | null)>(n).fill(null)

  const swingHighs: number[] = []
  const swingLows: number[] = []
  let bias: 'long' | 'short' | null = null
  let biasAge = 0
  const left = config.swingLeft
  const right = config.swingRight

  for (let i = 0; i < n; i++) {
    const confirmIdx = i - right
    if (confirmIdx >= left) {
      if (confirmSwingHigh(highs, confirmIdx, left, right)) {
        swingHighs.push(highs[confirmIdx])
        if (swingHighs.length > MAX_SWINGS) swingHighs.shift()
      }
      if (confirmSwingLow(lows, confirmIdx, left, right)) {
        swingLows.push(lows[confirmIdx])
        if (swingLows.length > MAX_SWINGS) swingLows.shift()
      }
    }

    const closed = i - 1
    if (closed < 1) continue

    const cClose = closes[closed]
    const cOpen = opens[closed]

    if (
      swingHighs.length > 0 &&
      cClose > swingHighs[swingHighs.length - 1] * (1 + config.minBreakPct)
    ) {
      bias = 'long'
      biasAge = 0
    } else if (
      swingLows.length > 0 &&
      cClose < swingLows[swingLows.length - 1] * (1 - config.minBreakPct)
    ) {
      bias = 'short'
      biasAge = 0
    } else if (bias !== null) {
      biasAge += 1
      if (biasAge > config.maxBiasBars) bias = null
    }

    if (bias === null || !sessionOk(openTimesMs[i], config)) continue

    const rng = highs[closed] - lows[closed]
    if (rng <= 0) continue

    const bodyRatio = Math.abs(cClose - cOpen) / rng
    if (bodyRatio < config.minBodyRatio) continue

    const e = emaVals[closed]
    let signalSide = bias
    if (config.fadeBos) {
      signalSide = bias === 'long' ? 'short' : 'long'
    }

    if (signalSide === 'long') {
      if (!config.allowLong) continue
      if (!config.fadeBos && cClose <= cOpen) continue
      if (e !== null && (config.fadeBos ? cClose >= e : cClose <= e)) continue
      const rv = rsiVals[closed]
      if (rv !== null && rv < config.rsiLongMin) continue
      entryBar[i] = true
      side[i] = 'long'
    } else {
      if (!config.allowShort) continue
      if (!config.fadeBos && cClose >= cOpen) continue
      if (e !== null && (config.fadeBos ? cClose <= e : cClose >= e)) continue
      const rv = rsiVals[closed]
      if (rv !== null && rv > config.rsiShortMax) continue
      entryBar[i] = true
      side[i] = 'short'
    }
  }

  return { entryBar, side }
}

export function resolveBosFlowAtOpen(
  index: number,
  candles: ChartCandle[],
  config: BosFlowConfig = DEFAULT_BOS_FLOW_CONFIG,
  nextBarOpenTimeMs?: number,
): MarketTrend | null {
  if (index < 0) return null

  if (index < candles.length) {
    const signals = generateBosFlowSignals(candles, config)
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
  const signals = generateBosFlowSignals(extended, config)
  return signals.entryBar[index] ? signals.side[index] : null
}
