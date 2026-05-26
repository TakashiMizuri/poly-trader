export const LOCAL_TIME_STORAGE_KEY = 'poly-trader-local-time'

export function getStoredUseLocalTime(): boolean {
  try {
    const stored = localStorage.getItem(LOCAL_TIME_STORAGE_KEY)
    if (stored === '0') return false
    if (stored === '1') return true
  } catch {
    /* ignore */
  }
  return true
}
