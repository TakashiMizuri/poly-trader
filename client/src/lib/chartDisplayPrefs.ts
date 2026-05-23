import { MARKET_DATA_MAX_CANDLES } from '@/constants/marketData'
import {
  DEFAULT_TREND_BET_STRATEGY_PARAMS,
  type BetStakeMode,
  type TrendBetStrategyParams,
} from '@/types/trendBetStrategy'

export const CHART_MAX_CANDLES_MIN = 100
export const CHART_MAX_CANDLES_MAX = 10_000
export const DEFAULT_CHART_MAX_CANDLES = MARKET_DATA_MAX_CANDLES

export const CHART_DISPLAY_PREFS_CHANGED_EVENT =
  'poly-trader-chart-display-changed'

export interface ChartBacktestParams {
  startBalance: number
  betStake: number
  betStakeMode: BetStakeMode
  betStakePercent: number
  commissionPercent: number
  maxBetStakeUsd: number | null
}

export interface ChartDisplayPrefs {
  showBetMarkers: boolean
  showTrends: boolean
  showBosOverlay: boolean
  /** Simulated balance line on the left price scale. */
  showEquityCurve: boolean
  /** Max DD / WR / PnL panel on the chart pane. */
  showBacktestStats: boolean
  /** How many recent BTC candles to load and render. */
  maxCandles: number
  backtest: ChartBacktestParams
}

export const DEFAULT_CHART_BACKTEST_PARAMS: ChartBacktestParams = {
  startBalance: DEFAULT_TREND_BET_STRATEGY_PARAMS.startBalance,
  betStake: DEFAULT_TREND_BET_STRATEGY_PARAMS.betStake,
  betStakeMode: DEFAULT_TREND_BET_STRATEGY_PARAMS.betStakeMode,
  betStakePercent: DEFAULT_TREND_BET_STRATEGY_PARAMS.betStakePercent,
  commissionPercent: DEFAULT_TREND_BET_STRATEGY_PARAMS.commissionPercent,
  maxBetStakeUsd: DEFAULT_TREND_BET_STRATEGY_PARAMS.maxBetStakeUsd,
}

export const DEFAULT_CHART_DISPLAY_PREFS: ChartDisplayPrefs = {
  showBetMarkers: true,
  showTrends: true,
  showBosOverlay: true,
  showEquityCurve: true,
  showBacktestStats: true,
  maxCandles: DEFAULT_CHART_MAX_CANDLES,
  backtest: { ...DEFAULT_CHART_BACKTEST_PARAMS },
}

const STORAGE_KEY = 'poly-trader-chart-display'
const LEGACY_STRATEGY_PARAMS_KEY = 'poly-trader-trend-bet-strategy-params'

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeMaxCandles(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DEFAULT_CHART_MAX_CANDLES
  return Math.round(
    clampNumber(
      Number.isFinite(n) ? n : DEFAULT_CHART_MAX_CANDLES,
      CHART_MAX_CANDLES_MIN,
      CHART_MAX_CANDLES_MAX,
    ),
  )
}

export function normalizeChartDisplayPrefs(
  raw: Partial<ChartDisplayPrefs> | null | undefined,
): ChartDisplayPrefs {
  const base = DEFAULT_CHART_DISPLAY_PREFS
  if (!raw) return { ...base, backtest: { ...base.backtest } }

  return {
    showBetMarkers:
      typeof raw.showBetMarkers === 'boolean'
        ? raw.showBetMarkers
        : base.showBetMarkers,
    showTrends:
      typeof raw.showTrends === 'boolean' ? raw.showTrends : base.showTrends,
    showBosOverlay:
      typeof raw.showBosOverlay === 'boolean'
        ? raw.showBosOverlay
        : base.showBosOverlay,
    showEquityCurve:
      typeof raw.showEquityCurve === 'boolean'
        ? raw.showEquityCurve
        : base.showEquityCurve,
    showBacktestStats:
      typeof raw.showBacktestStats === 'boolean'
        ? raw.showBacktestStats
        : base.showBacktestStats,
    maxCandles: normalizeMaxCandles(raw.maxCandles),
    backtest: normalizeChartBacktestParams(raw.backtest),
  }
}

export function normalizeChartBacktestParams(
  raw: Partial<ChartBacktestParams> | null | undefined,
): ChartBacktestParams {
  const base = DEFAULT_CHART_BACKTEST_PARAMS
  if (!raw) return { ...base }

  const rawMode = raw.betStakeMode as BetStakeMode | undefined
  const betStakeMode: BetStakeMode =
    rawMode === 'fixed' || rawMode === 'percent' ? rawMode : base.betStakeMode

  const maxRaw = raw.maxBetStakeUsd
  const maxResolved: number | null =
    maxRaw === null || maxRaw === undefined
      ? base.maxBetStakeUsd
      : clampNumber(maxRaw, 0, 1_000_000)

  return {
    startBalance: clampNumber(raw.startBalance ?? base.startBalance, 1, 1_000_000_000),
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
    maxBetStakeUsd:
      maxResolved != null && maxResolved > 0 ? maxResolved : null,
  }
}

function tryLoadLegacyBacktestParams(): Partial<ChartBacktestParams> | null {
  try {
    const stored = localStorage.getItem(LEGACY_STRATEGY_PARAMS_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as Partial<ChartBacktestParams>
    localStorage.removeItem(LEGACY_STRATEGY_PARAMS_KEY)
    return parsed
  } catch {
    return null
  }
}

export function chartBacktestToStrategyParams(
  backtest: ChartBacktestParams,
): TrendBetStrategyParams {
  const normalized = normalizeChartBacktestParams(backtest)
  return {
    ...DEFAULT_TREND_BET_STRATEGY_PARAMS,
    ...normalized,
  }
}

export function loadChartDisplayPrefs(): ChartDisplayPrefs {
  const legacyBacktest = tryLoadLegacyBacktestParams()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        ...DEFAULT_CHART_DISPLAY_PREFS,
        backtest: normalizeChartBacktestParams(legacyBacktest),
      }
    }
    const parsed = JSON.parse(raw) as Partial<ChartDisplayPrefs>
    const merged: Partial<ChartDisplayPrefs> = { ...parsed }
    if (parsed.backtest == null && legacyBacktest) {
      merged.backtest = normalizeChartBacktestParams(legacyBacktest)
    }
    return normalizeChartDisplayPrefs(merged)
  } catch {
    return {
      ...DEFAULT_CHART_DISPLAY_PREFS,
      backtest: normalizeChartBacktestParams(legacyBacktest),
    }
  }
}

export function saveChartDisplayPrefs(prefs: ChartDisplayPrefs): void {
  const normalized = normalizeChartDisplayPrefs(prefs)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(
      new CustomEvent(CHART_DISPLAY_PREFS_CHANGED_EVENT, {
        detail: normalized,
      }),
    )
  } catch {
    // ignore quota / private mode
  }
}
