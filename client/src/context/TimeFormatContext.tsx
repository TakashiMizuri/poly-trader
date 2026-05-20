import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getStoredTimeFormat,
  TIME_FORMAT_STORAGE_KEY,
  type TimeFormat,
} from '@/lib/timeFormat'

interface TimeFormatContextValue {
  timeFormat: TimeFormat
  setTimeFormat: (format: TimeFormat) => void
}

const TimeFormatContext = createContext<TimeFormatContextValue | null>(null)

export function TimeFormatProvider({ children }: { children: ReactNode }) {
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(() => getStoredTimeFormat())

  const setTimeFormat = useCallback((next: TimeFormat) => {
    setTimeFormatState(next)
    try {
      localStorage.setItem(TIME_FORMAT_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(() => ({ timeFormat, setTimeFormat }), [timeFormat, setTimeFormat])

  return (
    <TimeFormatContext.Provider value={value}>{children}</TimeFormatContext.Provider>
  )
}

export function useTimeFormat() {
  const ctx = useContext(TimeFormatContext)
  if (!ctx) {
    throw new Error('useTimeFormat must be used within TimeFormatProvider')
  }
  return ctx
}
