import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getStoredPaperTradingEnabled,
  PAPER_TRADING_STORAGE_KEY,
} from '@/lib/paperTrading'

interface PaperTradingContextValue {
  paperTradingEnabled: boolean
  setPaperTradingEnabled: (enabled: boolean) => void
}

const PaperTradingContext = createContext<PaperTradingContextValue | null>(null)

export function PaperTradingProvider({ children }: { children: ReactNode }) {
  const [paperTradingEnabled, setPaperTradingEnabledState] = useState<boolean>(
    () => getStoredPaperTradingEnabled(),
  )

  const setPaperTradingEnabled = useCallback((enabled: boolean) => {
    setPaperTradingEnabledState(enabled)
    try {
      localStorage.setItem(PAPER_TRADING_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({ paperTradingEnabled, setPaperTradingEnabled }),
    [paperTradingEnabled, setPaperTradingEnabled],
  )

  return (
    <PaperTradingContext.Provider value={value}>
      {children}
    </PaperTradingContext.Provider>
  )
}

export function usePaperTrading() {
  const ctx = useContext(PaperTradingContext)
  if (!ctx) {
    throw new Error('usePaperTrading must be used within PaperTradingProvider')
  }
  return ctx
}
