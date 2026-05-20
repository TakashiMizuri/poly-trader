export type BetStakeMode = 'fixed' | 'percent'

export interface TrendBetStrategyParams {
  startBalance: number
  /** Fixed USD amount, or ignored when {@link betStakeMode} is `percent`. */
  betStake: number
  betStakeMode: BetStakeMode
  /** % of current balance per bet when {@link betStakeMode} is `percent` (e.g. 1 = 1%). */
  betStakePercent: number
  /** Fee as % of stake charged on each bet (win or loss). */
  commissionPercent: number
  /** Bars whose low/high define structure (1 = previous bar only). */
  structureLookback: number
  /** Min bars in segment before BoS can flip (reduces noise). */
  bosMinSegmentBars: number
  /** Min bars between two BoS flips (reduces trend spam). */
  bosMinBarsBetweenFlips: number
  /** Close must break structure by at least this (0 = off). */
  bosBreakBuffer: number
  /** Break detected by body, not wick. */
  bosBodyBreakOnly: boolean
  /**
   * Only bet if at least this many bars since last confirmed BoS (0 = off).
   */
  minBarsSinceFlip: number
  /** Only bet if at most this many bars since last confirmed BoS (0 = off). */
  maxBarsSinceFlip: number
  /** Skip if open is closer than this to break level (0 = off). */
  minDistanceFromStructure: number
  /** Consecutive same-color bars for exhaustion fade. */
  exhaustionConsecutiveBars: number
}

export const DEFAULT_TREND_BET_STRATEGY_PARAMS: TrendBetStrategyParams = {
  startBalance: 100,
  betStake: 1,
  betStakeMode: 'percent',
  betStakePercent: 1,
  commissionPercent: 0,
  structureLookback: 5,
  bosMinSegmentBars: 0,
  bosMinBarsBetweenFlips: 0,
  bosBreakBuffer: 0,
  bosBodyBreakOnly: false,
  minBarsSinceFlip: 0,
  maxBarsSinceFlip: 0,
  minDistanceFromStructure: 0,
  exhaustionConsecutiveBars: 3,
}
