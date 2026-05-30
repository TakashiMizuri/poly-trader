import { HubConnectionState, type HubConnection } from '@microsoft/signalr'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createTradingConnection } from '@/api/signalR'
import type { LiveLogEntry } from '@/types/liveLog'

const MAX_LIVE_LOGS = 500

function normalizeLogEntry(raw: LiveLogEntry): LiveLogEntry {
  return {
    timestamp:
      typeof raw.timestamp === 'string'
        ? raw.timestamp
        : new Date().toISOString(),
    level: raw.level ?? 'Information',
    message: raw.message ?? '',
    sourceContext: raw.sourceContext ?? null,
    exception: raw.exception ?? null,
  }
}

export type TradingLiveEvent =
  | 'BalanceUpdated'
  | 'EngineStatus'
  | 'MarketWindowUpdated'
  | 'TradePlaced'
  | 'EntryFailed'
  | 'PositionsFeedChanged'
  | 'CandleClosed'

type TradingLiveContextValue = {
  liveConnected: boolean
  /** False until the first hub start attempt finishes (avoids "Reconnecting" flash on load). */
  liveConnectAttempted: boolean
  logs: LiveLogEntry[]
  clearLogs: () => void
  subscribe: (event: TradingLiveEvent, handler: () => void) => () => void
}

const TradingLiveContext = createContext<TradingLiveContextValue | null>(null)

export function TradingLiveProvider({ children }: { children: ReactNode }) {
  const [liveConnected, setLiveConnected] = useState(false)
  const [liveConnectAttempted, setLiveConnectAttempted] = useState(false)
  const [logs, setLogs] = useState<LiveLogEntry[]>([])
  const connRef = useRef<HubConnection | null>(null)
  const handlersRef = useRef(
    new Map<TradingLiveEvent, Set<() => void>>(),
  )

  const emit = useCallback((event: TradingLiveEvent) => {
    handlersRef.current.get(event)?.forEach((h) => h())
  }, [])

  const subscribe = useCallback(
    (event: TradingLiveEvent, handler: () => void) => {
      let set = handlersRef.current.get(event)
      if (!set) {
        set = new Set()
        handlersRef.current.set(event, set)
      }
      set.add(handler)
      return () => set!.delete(handler)
    },
    [],
  )

  useEffect(() => {
    const conn = createTradingConnection()
    connRef.current = conn

    const syncLive = () =>
      setLiveConnected(conn.state === HubConnectionState.Connected)

    conn.onreconnected(syncLive)
    conn.onclose(syncLive)
    conn.on('BalanceUpdated', () => emit('BalanceUpdated'))
    conn.on('EngineStatus', () => emit('EngineStatus'))
    conn.on('MarketWindowUpdated', () => emit('MarketWindowUpdated'))
    conn.on('TradePlaced', () => emit('TradePlaced'))
    conn.on('EntryFailed', () => emit('EntryFailed'))
    conn.on('PositionsFeedChanged', () => emit('PositionsFeedChanged'))
    conn.on('CandleClosed', () => emit('CandleClosed'))
    conn.on('LogEntry', (entry: LiveLogEntry) => {
      setLogs((prev) => {
        const next = [...prev, normalizeLogEntry(entry)]
        return next.length > MAX_LIVE_LOGS
          ? next.slice(next.length - MAX_LIVE_LOGS)
          : next
      })
    })

    conn
      .start()
      .then(syncLive)
      .catch(console.error)
      .finally(() => setLiveConnectAttempted(true))

    return () => {
      void conn.stop()
      connRef.current = null
    }
  }, [emit])

  const clearLogs = useCallback(() => setLogs([]), [])

  return (
    <TradingLiveContext.Provider
      value={{
        liveConnected,
        liveConnectAttempted,
        logs,
        clearLogs,
        subscribe,
      }}
    >
      {children}
    </TradingLiveContext.Provider>
  )
}

export function useTradingLive() {
  const ctx = useContext(TradingLiveContext)
  if (!ctx) {
    throw new Error('useTradingLive must be used within TradingLiveProvider')
  }
  return ctx
}

export function useTradingLiveEvent(
  event: TradingLiveEvent,
  handler: () => void,
) {
  const { subscribe } = useTradingLive()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(
    () => subscribe(event, () => handlerRef.current()),
    [event, subscribe],
  )
}
