import { clearAllPollCaches } from '@/api/poll-cache'

export const GLOBAL_RESET_EVENT = 'poly-trader-global-reset'

const LEGACY_STRATEGY_PARAMS_KEY = 'poly-trader-trend-bet-strategy-params'
const LEGACY_CHART_LAYERS_KEY = 'poly-trader-chart-layers'

/** Clears legacy browser keys (not chart display, theme, or API token). */
export function clearClientTradingState(): void {
  localStorage.removeItem(LEGACY_STRATEGY_PARAMS_KEY)
  localStorage.removeItem(LEGACY_CHART_LAYERS_KEY)
}

export function notifyGlobalReset(): void {
  clearAllPollCaches()
  window.dispatchEvent(new CustomEvent(GLOBAL_RESET_EVENT))
}
