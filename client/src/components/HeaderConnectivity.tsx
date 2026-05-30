import { useCallback, useEffect } from 'react'
import { api, type ConnectivityResponse } from '@/api/client'
import { usePoll } from '@/api/hooks'
import { useTradingLive, useTradingLiveEvent } from '@/api/tradingLive'
import {
  StatusHeaderSkeleton,
  StatusLightDot,
} from '@/components/status-lights'
import { GLOBAL_RESET_EVENT } from '@/lib/appReset'

const CONNECTIVITY_POLL_MS = 12_000

async function fetchConnectivity() {
  return api<ConnectivityResponse>('/api/health/connectivity')
}

export function HeaderConnectivity() {
  const { liveConnected, liveConnectAttempted } = useTradingLive()
  const connectivityPoll = usePoll(
    useCallback(() => fetchConnectivity(), []),
    CONNECTIVITY_POLL_MS,
    { cacheKey: 'api/health/connectivity' },
  )

  const connectivity = connectivityPoll.data
  const pending =
    connectivityPoll.loading && connectivityPoll.data == null

  useEffect(() => {
    const onReset = () => void connectivityPoll.refresh()
    window.addEventListener(GLOBAL_RESET_EVENT, onReset)
    return () => window.removeEventListener(GLOBAL_RESET_EVENT, onReset)
  }, [connectivityPoll.refresh])

  useTradingLiveEvent('EngineStatus', () => {
    void connectivityPoll.refresh()
  })

  return (
    <div
      className="flex shrink-0 select-none items-center gap-0.5 sm:gap-1"
      aria-label="Connection status"
    >
      {pending ? (
        <StatusHeaderSkeleton count={6} />
      ) : (
        <>
          <StatusLightDot
            label="Live updates"
            status={
              liveConnected
                ? 'ok'
                : !liveConnectAttempted
                  ? 'idle'
                  : 'warn'
            }
            detail={
              liveConnected
                ? 'SignalR connected'
                : !liveConnectAttempted
                  ? 'Connecting…'
                  : 'Reconnecting…'
            }
          />
          {connectivity?.checks.map((c) => (
            <StatusLightDot
              key={c.id}
              label={c.label}
              status={c.status}
              detail={c.detail}
            />
          ))}
        </>
      )}
    </div>
  )
}
