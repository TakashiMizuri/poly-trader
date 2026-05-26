import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getStoredUseLocalTime, LOCAL_TIME_STORAGE_KEY } from '@/lib/localTimeDisplay'
import {
  getStoredTimeFormat,
  TIME_FORMAT_STORAGE_KEY,
  type TimeFormat,
} from '@/lib/timeFormat'

interface TimeFormatContextValue {
  timeFormat: TimeFormat
  setTimeFormat: (format: TimeFormat) => void
  useLocalTime: boolean
  setUseLocalTime: (enabled: boolean) => void
}

const TimeFormatContext = createContext<TimeFormatContextValue | null>(null)

export function TimeFormatProvider({ children }: { children: ReactNode }) {
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(() => getStoredTimeFormat())
  const [useLocalTime, setUseLocalTimeState] = useState<boolean>(() => getStoredUseLocalTime())

  const setTimeFormat = useCallback((next: TimeFormat) => {
    setTimeFormatState(next)
    try {
      localStorage.setItem(TIME_FORMAT_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const setUseLocalTime = useCallback((enabled: boolean) => {
    setUseLocalTimeState(enabled)
    try {
      localStorage.setItem(LOCAL_TIME_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({ timeFormat, setTimeFormat, useLocalTime, setUseLocalTime }),
    [timeFormat, setTimeFormat, useLocalTime, setUseLocalTime],
  )

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
