import { lastMarketDataCandles } from '@/constants/marketData'
import type { ChartCandle } from '@/types/candle'
import type { TrendBetStrategyParams } from '@/types/trendBetStrategy'
import { DEFAULT_TREND_BET_STRATEGY_PARAMS } from '@/types/trendBetStrategy'
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure'
import { generateBlendFade2Signals } from '@/utils/chart/blendFade2Signals'
import {
  resolveBetAtOpen,
  resolveBetForUpcomingBar,
} from '@/utils/chart/resolveBetAtOpen'
import {
  clampBalanceAfterBet,
  resolveBetStakeForBalance,
  resolveRequestedBetStake,
} from '@/utils/chart/safeBetStake'

/** @deprecated Use {@link DEFAULT_TREND_BET_STRATEGY_PARAMS}.betStake */
export const BET_STAKE = DEFAULT_TREND_BET_STRATEGY_PARAMS.betStake
/** @deprecated Use {@link DEFAULT_TREND_BET_STRATEGY_PARAMS}.startBalance */
export const DEFAULT_START_BALANCE = DEFAULT_TREND_BET_STRATEGY_PARAMS.startBalance

export interface TrendBet {
  time: number
  trend: MarketTrend
  open: number
  high: number
  low: number
  close: number
  won: boolean
  pnl: number
  stake: number
  commission: number
  balanceAfter: number
}

export interface TrendSideStats {
  total: number
  wins: number
  losses: number
  netPnl: number
}

/** Entry for the next candle, decided when the previous candle closes. */
export interface TrendBetEntrySignal {
  targetCandleTime: number
  trend: MarketTrend
}

/** Outcome when a candle closes — same rules as chart backtest and paper/live engine. */
export interface TrendBetSettlement {
  candleTime: number
  won: boolean
  pnl: number
  commission: number
}

export interface CandleCloseStrategyResult {
  settlement: TrendBetSettlement | null
  entry: TrendBetEntrySignal | null
}

export interface TrendBetSimulation {
  startBalance: number
  endBalance: number
  netPnl: number
  totalBets: number
  wins: number
  losses: number
  winRate: number
  longStats: TrendSideStats
  shortStats: TrendSideStats
  maxDrawdown: number
  maxDrawdownPct: number
  /** Bars with no bet (filters, warmup, no signal, or ruin guard). */
  skippedBars: number
  /** Lowest balance during the run (ruin guard keeps this above floor). */
  minBalance: number
  bets: TrendBet[]
  equityCurve: Array<{ time: number; value: number }>
  params: TrendBetStrategyParams
}

function isBetWon(trend: MarketTrend, candle: ChartCandle): boolean {
  return trend === 'long'
    ? candle.close > candle.open
    : candle.close < candle.open
}

export function computeBetPnl(
  won: boolean,
  stake: number,
  commissionPercent: number,
): { pnl: number; commission: number } {
  const commission = stake * (commissionPercent / 100)
  const gross = won ? stake : -stake
  return { pnl: gross - commission, commission }
}

/** lightweight-charts requires strictly ascending unique times. */
function coalesceEquityCurve(
  points: Array<{ time: number; value: number }>,
): Array<{ time: number; value: number }> {
  if (points.length === 0) return points

  const sorted = [...points].sort((a, b) => a.time - b.time)
  const result: Array<{ time: number; value: number }> = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const point = sorted[i]
    const prev = result[result.length - 1]
    if (point.time === prev.time) {
      prev.value = point.value
      continue
    }
    if (point.time > prev.time) {
      result.push(point)
    }
  }

  return result
}

/**
 * Live/paper: settle the candle that just closed, then signal entry for the next candle.
 */
export function processCandleClose(
  closedCandle: ChartCandle,
  closedCandles: ChartCandle[],
  candleIntervalSeconds: number,
  params: TrendBetStrategyParams = DEFAULT_TREND_BET_STRATEGY_PARAMS,
): CandleCloseStrategyResult | null {
  if (closedCandles.length === 0) return null

  let closedIndexInInput = -1
  for (let i = closedCandles.length - 1; i >= 0; i--) {
    if (closedCandles[i].time === closedCandle.time) {
      closedIndexInInput = i
      break
    }
  }
  if (closedIndexInInput < 0) return null

  const window = lastMarketDataCandles(
    closedCandles.slice(0, closedIndexInInput + 1),
  )

  const closedIndex = window.length - 1
  if (window[closedIndex]?.time !== closedCandle.time) return null
  const emptyTrend: MarketTrend[] = []

  let settlement: TrendBetSettlement | null = null
  const betAtOpen = resolveBetAtOpen(
    closedIndex,
    window,
    emptyTrend,
    params,
  )
  if (betAtOpen !== null) {
    const balanceAtOpen = computeBalanceAtBarOpen(
      window,
      closedIndex,
      params,
    )
    const stake =
      resolveBetStakeForBalance(balanceAtOpen, params) ??
      resolveRequestedBetStake(balanceAtOpen, params)
    const won = isBetWon(betAtOpen, closedCandle)
    const { pnl, commission } = computeBetPnl(
      won,
      stake,
      params.commissionPercent,
    )
    settlement = {
      candleTime: closedCandle.time,
      won,
      pnl,
      commission,
    }
  }

  let entry: TrendBetEntrySignal | null = null
  if (candleIntervalSeconds > 0) {
    const nextOpenTime = closedCandle.time + candleIntervalSeconds
    const nextBet = resolveBetForUpcomingBar(
      window,
      emptyTrend,
      'long',
      params,
      nextOpenTime,
    )
    if (nextBet !== null) {
      entry = {
        targetCandleTime: nextOpenTime,
        trend: nextBet,
      }
    }
  }

  return { settlement, entry }
}

/** Balance at the open of bar `barIndex` (after all prior settlements). */
function computeBalanceAtBarOpen(
  candles: ChartCandle[],
  barIndex: number,
  params: TrendBetStrategyParams,
): number {
  const signals = generateBlendFade2Signals(candles, params.blendFade2)
  let balance = params.startBalance
  for (let i = 0; i < barIndex; i++) {
    if (!signals.entryBar[i] || signals.side[i] === null) continue
    const stake = resolveBetStakeForBalance(balance, params)
    if (stake === null) continue
    const { pnl } = computeBetPnl(
      isBetWon(signals.side[i]!, candles[i]),
      stake,
      params.commissionPercent,
    )
    balance = clampBalanceAfterBet(balance + pnl)
  }
  return balance
}

/**
 * Backtest on closed candles: bet only when blend_fade2 signals at bar open.
 */
export function simulateTrendBetStrategy(
  candles: ChartCandle[],
  _trendAtOpen?: MarketTrend[],
  params: TrendBetStrategyParams = DEFAULT_TREND_BET_STRATEGY_PARAMS,
  _bosFlipAt?: boolean[],
): TrendBetSimulation | null {
  if (candles.length === 0) return null

  const signals = generateBlendFade2Signals(candles, params.blendFade2)
  const { startBalance, commissionPercent } = params
  const bets: TrendBet[] = []
  const equityCurve: Array<{ time: number; value: number }> = []

  let balance = startBalance
  let peakBalance = startBalance
  let maxDrawdown = 0
  let maxDrawdownPct = 0

  const longStats: TrendSideStats = {
    total: 0,
    wins: 0,
    losses: 0,
    netPnl: 0,
  }
  const shortStats: TrendSideStats = {
    total: 0,
    wins: 0,
    losses: 0,
    netPnl: 0,
  }

  let skippedBars = 0
  let minBalance = balance

  for (let i = 0; i < candles.length; i++) {
    if (!signals.entryBar[i] || signals.side[i] === null) {
      skippedBars++
      continue
    }

    const stake = resolveBetStakeForBalance(balance, params)
    if (stake === null) {
      skippedBars++
      continue
    }

    const candle = candles[i]
    const trend = signals.side[i]!
    const won = isBetWon(trend, candle)
    const { pnl, commission } = computeBetPnl(
      won,
      stake,
      commissionPercent,
    )
    balance = clampBalanceAfterBet(balance + pnl)
    if (balance < minBalance) {
      minBalance = balance
    }

    const sideStats = trend === 'long' ? longStats : shortStats
    sideStats.total += 1
    sideStats.netPnl += pnl
    if (won) {
      sideStats.wins += 1
    } else {
      sideStats.losses += 1
    }

    bets.push({
      time: candle.time,
      trend,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      won,
      pnl,
      stake,
      commission,
      balanceAfter: balance,
    })
    equityCurve.push({ time: candle.time, value: balance })

    if (balance > peakBalance) {
      peakBalance = balance
    }
    const drawdown = peakBalance - balance
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPct =
        peakBalance > 0 ? (drawdown / peakBalance) * 100 : 0
    }
  }

  const wins = bets.filter((b) => b.won).length
  const losses = bets.length - wins

  return {
    startBalance,
    endBalance: balance,
    netPnl: balance - startBalance,
    totalBets: bets.length,
    wins,
    losses,
    winRate: bets.length > 0 ? (wins / bets.length) * 100 : 0,
    longStats,
    shortStats,
    maxDrawdown,
    maxDrawdownPct,
    skippedBars,
    minBalance,
    bets,
    equityCurve: coalesceEquityCurve(equityCurve),
    params,
  }
}
