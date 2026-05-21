import {
  BLEND_FADE2_PRESET_PNL_MAX,
  type BlendFade2Config,
} from '@/types/blendFade2Config'

export type BetStakeMode = 'fixed' | 'percent'

export interface TrendBetStrategyParams {
  startBalance: number
  /** Fixed USD amount, or ignored when {@link betStakeMode} is `percent`. */
  betStake: number
  betStakeMode: BetStakeMode
  /** % of current balance per bet when {@link betStakeMode} is `percent` (3 = 3% per STRATEGY.md). */
  betStakePercent: number
  /** Entry fee as % of stake (3.5 = Polymarket crypto taker fee on premium). */
  commissionPercent: number
  /** Cap stake in USD (500 = blend_fade2 backtest default). */
  maxBetStakeUsd: number | null
  /** Blend fade 2 signal parameters (blend2_pnl_max preset). */
  blendFade2: BlendFade2Config
}

export const DEFAULT_TREND_BET_STRATEGY_PARAMS: TrendBetStrategyParams = {
  startBalance: 100,
  betStake: 1,
  betStakeMode: 'percent',
  betStakePercent: 3,
  commissionPercent: 3.5,
  maxBetStakeUsd: 500,
  blendFade2: BLEND_FADE2_PRESET_PNL_MAX,
}
