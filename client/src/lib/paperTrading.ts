export const PAPER_TRADING_STORAGE_KEY = 'poly-trader-paper-trading-enabled'

export function getStoredPaperTradingEnabled(): boolean {
  try {
    const stored = localStorage.getItem(PAPER_TRADING_STORAGE_KEY)
    if (stored === '0' || stored === 'false') return false
    if (stored === '1' || stored === 'true') return true
  } catch {
    /* ignore */
  }
  return true
}
