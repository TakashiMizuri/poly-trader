import {
  DEFAULT_TREND_BET_STRATEGY_PARAMS,
  type BetStakeMode,
  type TrendBetStrategyParams,
} from '@/types/trendBetStrategy'

const STORAGE_KEY = 'poly-trader-trend-bet-strategy-params'

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.floor(clampNumber(value, min, max))
}

export function normalizeTrendBetStrategyParams(
  raw: Partial<TrendBetStrategyParams> | null | undefined,
): TrendBetStrategyParams {
  const base = DEFAULT_TREND_BET_STRATEGY_PARAMS
  if (!raw) return { ...base }

  const rawMode = raw.betStakeMode as BetStakeMode | undefined
  const betStakeMode: BetStakeMode =
    rawMode === 'fixed' || rawMode === 'percent' ? rawMode : base.betStakeMode

  return {
    startBalance: clampNumber(raw.startBalance ?? base.startBalance, 0, 1_000_000_000),
    betStake: clampNumber(raw.betStake ?? base.betStake, 0.01, 1_000_000),
    betStakeMode,
    betStakePercent: clampNumber(
      raw.betStakePercent ?? base.betStakePercent,
      0.01,
      100,
    ),
    commissionPercent: clampNumber(
      raw.commissionPercent ?? base.commissionPercent,
      0,
      100,
    ),
    structureLookback: clampInt(raw.structureLookback ?? base.structureLookback, 1, 50),
    bosMinSegmentBars: clampInt(
      raw.bosMinSegmentBars ?? base.bosMinSegmentBars,
      0,
      100,
    ),
    bosMinBarsBetweenFlips: clampInt(
      raw.bosMinBarsBetweenFlips ?? base.bosMinBarsBetweenFlips,
      0,
      100,
    ),
    bosBreakBuffer: clampNumber(raw.bosBreakBuffer ?? base.bosBreakBuffer, 0, 1_000_000),
    bosBodyBreakOnly: raw.bosBodyBreakOnly ?? base.bosBodyBreakOnly,
    minBarsSinceFlip: clampInt(raw.minBarsSinceFlip ?? base.minBarsSinceFlip, 0, 500),
    maxBarsSinceFlip: clampInt(raw.maxBarsSinceFlip ?? base.maxBarsSinceFlip, 0, 500),
    minDistanceFromStructure: clampNumber(
      raw.minDistanceFromStructure ?? base.minDistanceFromStructure,
      0,
      1_000_000,
    ),
    exhaustionConsecutiveBars: clampInt(
      raw.exhaustionConsecutiveBars ?? base.exhaustionConsecutiveBars,
      2,
      20,
    ),
  }
}

export function loadTrendBetStrategyParams(): TrendBetStrategyParams {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_TREND_BET_STRATEGY_PARAMS }
    return normalizeTrendBetStrategyParams(
      JSON.parse(stored) as Partial<TrendBetStrategyParams>,
    )
  } catch {
    return { ...DEFAULT_TREND_BET_STRATEGY_PARAMS }
  }
}

export function saveTrendBetStrategyParams(params: TrendBetStrategyParams): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params))
  } catch {
    // ignore quota / private mode
  }
}
