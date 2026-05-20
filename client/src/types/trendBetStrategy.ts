import {
  BOS_FLOW_PRESET_ACTIVE,
  type BosFlowConfig,
} from '@/types/bosFlowConfig'

export type BetStakeMode = 'fixed' | 'percent'

export interface TrendBetStrategyParams {
  startBalance: number
  /** Fixed USD amount, or ignored when {@link betStakeMode} is `percent`. */
  betStake: number
  betStakeMode: BetStakeMode
  /** % of current balance per bet when {@link betStakeMode} is `percent` (3 = 3% per STRATEGY.md). */
  betStakePercent: number
  /** Entry fee as % of stake (1.8 = 1.8% Polymarket entry fee). */
  commissionPercent: number
  /** Cap stake in USD (500 = bos_flow backtest default). */
  maxBetStakeUsd: number | null
  /** BoS flow signal parameters (flow_active preset). */
  bosFlow: BosFlowConfig
}

export const DEFAULT_TREND_BET_STRATEGY_PARAMS: TrendBetStrategyParams = {
  startBalance: 100,
  betStake: 1,
  betStakeMode: 'percent',
  betStakePercent: 3,
  commissionPercent: 1.8,
  maxBetStakeUsd: 500,
  bosFlow: BOS_FLOW_PRESET_ACTIVE,
}
