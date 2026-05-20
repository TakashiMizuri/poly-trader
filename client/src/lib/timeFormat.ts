export type TimeFormat = '12h' | '24h'

export const TIME_FORMAT_STORAGE_KEY = 'poly-trader-time-format'

export function getStoredTimeFormat(): TimeFormat {
  try {
    const stored = localStorage.getItem(TIME_FORMAT_STORAGE_KEY)
    if (stored === '12h' || stored === '24h') return stored
  } catch {
    /* ignore */
  }
  return '24h'
}
