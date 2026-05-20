export interface ChartDisplayPrefs {
  /** Simulated strategy wins/losses (+/−) above candles. */
  showBetMarkers: boolean
  /** Long/short trend bands on the chart. */
  showTrends: boolean
  /** Bullish / bearish BoS break lines. */
  showBosOverlay: boolean
}

export const DEFAULT_CHART_DISPLAY_PREFS: ChartDisplayPrefs = {
  showBetMarkers: true,
  showTrends: true,
  showBosOverlay: true,
}

const STORAGE_KEY = 'poly-trader-chart-display'

export function loadChartDisplayPrefs(): ChartDisplayPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CHART_DISPLAY_PREFS }
    const parsed = JSON.parse(raw) as Partial<ChartDisplayPrefs>
    return {
      showBetMarkers:
        typeof parsed.showBetMarkers === 'boolean'
          ? parsed.showBetMarkers
          : DEFAULT_CHART_DISPLAY_PREFS.showBetMarkers,
      showTrends:
        typeof parsed.showTrends === 'boolean'
          ? parsed.showTrends
          : DEFAULT_CHART_DISPLAY_PREFS.showTrends,
      showBosOverlay:
        typeof parsed.showBosOverlay === 'boolean'
          ? parsed.showBosOverlay
          : DEFAULT_CHART_DISPLAY_PREFS.showBosOverlay,
    }
  } catch {
    return { ...DEFAULT_CHART_DISPLAY_PREFS }
  }
}

export function saveChartDisplayPrefs(prefs: ChartDisplayPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota / private mode
  }
}
