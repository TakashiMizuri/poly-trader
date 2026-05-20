import type { TrendBetStrategyParams } from '@/types/trendBetStrategy'

/** Balance never drops below this (ruin guard). */
export const BALANCE_FLOOR = 0.01

export const MIN_BET_STAKE = 0.01

/** Stake before ruin guard: fixed USD or % of current balance (compound). */
export function resolveRequestedBetStake(
  balance: number,
  params: Pick<
    TrendBetStrategyParams,
    'betStakeMode' | 'betStake' | 'betStakePercent' | 'maxBetStakeUsd'
  >,
): number {
  let stake =
    params.betStakeMode === 'percent'
      ? balance * (params.betStakePercent / 100)
      : params.betStake

  if (params.maxBetStakeUsd != null && params.maxBetStakeUsd > 0) {
    stake = Math.min(stake, params.maxBetStakeUsd)
  }
  return stake
}

/**
 * Stake for the next bet, or null if balance is too low to bet safely.
 */
export function resolveSafeBetStake(
  balance: number,
  requestedStake: number,
): number | null {
  const maxAffordable = balance - BALANCE_FLOOR
  const stake = Math.min(requestedStake, maxAffordable)
  if (stake < MIN_BET_STAKE) {
    return null
  }
  return stake
}

export function resolveBetStakeForBalance(
  balance: number,
  params: TrendBetStrategyParams,
): number | null {
  return resolveSafeBetStake(
    balance,
    resolveRequestedBetStake(balance, params),
  )
}

export function clampBalanceAfterBet(balance: number): number {
  return Math.max(balance, BALANCE_FLOOR)
}
