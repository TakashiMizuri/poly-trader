import type { LiveLogEntry } from '@/types/liveLog'

export type LogLevelFilter = 'INF' | 'WRN' | 'ERR'

export const LOG_LEVEL_FILTERS: LogLevelFilter[] = ['INF', 'WRN', 'ERR']

const FILTER_KEY = 'poly-trader-logs-level-filter'

export function classifyLogLevel(level: string): LogLevelFilter {
  const normalized = level.toLowerCase()
  if (normalized.includes('error') || normalized.includes('fatal')) {
    return 'ERR'
  }
  if (normalized.includes('warn')) {
    return 'WRN'
  }
  return 'INF'
}

export function readLevelFilterPreference(): Set<LogLevelFilter> {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) {
      return new Set(LOG_LEVEL_FILTERS)
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return new Set(LOG_LEVEL_FILTERS)
    }
    const selected = parsed.filter(
      (v): v is LogLevelFilter =>
        v === 'INF' || v === 'WRN' || v === 'ERR',
    )
    return new Set(selected)
  } catch {
    return new Set(LOG_LEVEL_FILTERS)
  }
}

export function writeLevelFilterPreference(active: Set<LogLevelFilter>) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...active]))
  } catch {
    /* private mode */
  }
}

export function filterLiveLogs(
  logs: LiveLogEntry[],
  active: ReadonlySet<LogLevelFilter>,
): LiveLogEntry[] {
  if (active.size === 0) {
    return []
  }
  return logs.filter((entry) => active.has(classifyLogLevel(entry.level)))
}
