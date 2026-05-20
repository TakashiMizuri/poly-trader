/** BoS flow strategy config (flow_active preset = best). */
export interface BosFlowConfig {
  swingLeft: number
  swingRight: number
  minBreakPct: number
  emaPeriod: number
  maxBiasBars: number
  minBodyRatio: number
  useRsiGate: boolean
  rsiPeriod: number
  rsiLongMin: number
  rsiShortMax: number
  allowLong: boolean
  allowShort: boolean
  fadeBos: boolean
  sessionUtcStart: number | null
  sessionUtcEnd: number | null
}

export const BOS_FLOW_PRESET_ACTIVE: BosFlowConfig = {
  swingLeft: 2,
  swingRight: 2,
  minBreakPct: 0.0001,
  emaPeriod: 50,
  maxBiasBars: 18,
  minBodyRatio: 0.05,
  useRsiGate: false,
  rsiPeriod: 14,
  rsiLongMin: 50,
  rsiShortMax: 50,
  allowLong: true,
  allowShort: true,
  fadeBos: true,
  sessionUtcStart: null,
  sessionUtcEnd: null,
}

export const DEFAULT_BOS_FLOW_CONFIG: BosFlowConfig = BOS_FLOW_PRESET_ACTIVE
