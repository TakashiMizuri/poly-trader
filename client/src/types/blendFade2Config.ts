/** Blend fade 2 strategy config (1:1 with trading-cursor-models strategies/blend_fade2). */
export interface BlendFade2Config {
  lookback: number
  lookbackFast: number
  zThreshold: number
  minRangePct: number
  zReversal: boolean
  zFastMin: number
  rankConfirm: number
  zMax: number
  sessionUtcStart: number | null
  sessionUtcEnd: number | null
}

export const BLEND_FADE2_PRESET_ACTIVE: BlendFade2Config = {
  lookback: 50,
  lookbackFast: 20,
  zThreshold: 1.08,
  minRangePct: 0.0026,
  zReversal: false,
  zFastMin: 0.64,
  rankConfirm: 0,
  zMax: 0,
  sessionUtcStart: null,
  sessionUtcEnd: null,
}

/** Best PnL from search_tune (batch 2). */
export const BLEND_FADE2_PRESET_PNL_MAX: BlendFade2Config = {
  lookback: 48,
  lookbackFast: 18,
  zThreshold: 1.08,
  minRangePct: 0.0026,
  zReversal: false,
  zFastMin: 0.60,
  rankConfirm: 0,
  zMax: 0,
  sessionUtcStart: null,
  sessionUtcEnd: null,
}

export const DEFAULT_BLEND_FADE2_CONFIG: BlendFade2Config = BLEND_FADE2_PRESET_PNL_MAX
