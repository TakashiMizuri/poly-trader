import { useCallback, useEffect, useState } from 'react'
import {
  CHART_DISPLAY_PREFS_CHANGED_EVENT,
  loadChartDisplayPrefs,
  normalizeChartDisplayPrefs,
  saveChartDisplayPrefs,
  type ChartDisplayPrefs,
} from '@/lib/chartDisplayPrefs'

export function useChartDisplayPrefs(): [
  ChartDisplayPrefs,
  (next: ChartDisplayPrefs) => void,
] {
  const [prefs, setPrefs] = useState(loadChartDisplayPrefs)

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<ChartDisplayPrefs>).detail
      setPrefs(detail ? normalizeChartDisplayPrefs(detail) : loadChartDisplayPrefs())
    }
    window.addEventListener(CHART_DISPLAY_PREFS_CHANGED_EVENT, sync)
    return () =>
      window.removeEventListener(CHART_DISPLAY_PREFS_CHANGED_EVENT, sync)
  }, [])

  const setChartDisplayPrefs = useCallback((next: ChartDisplayPrefs) => {
    const normalized = normalizeChartDisplayPrefs(next)
    setPrefs(normalized)
    saveChartDisplayPrefs(normalized)
  }, [])

  return [prefs, setChartDisplayPrefs]
}
