import { useCallback, useEffect, useRef, useState } from 'react'
import { readPollCache, writePollCache } from '@/api/poll-cache'

export type PollOptions = {
  cacheKey?: string
}

function hasCached<T>(cacheKey: string | undefined): boolean {
  return cacheKey != null && readPollCache<T>(cacheKey) != null
}

/** Fetches on mount; optional interval. Hydrates from sessionStorage when cacheKey is set. */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number | false = false,
  options?: PollOptions,
) {
  const cacheKey = options?.cacheKey
  const [data, setData] = useState<T | null>(() =>
    cacheKey ? readPollCache<T>(cacheKey) : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !hasCached<T>(cacheKey))
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const next = await fetcher()
      if (requestId !== requestIdRef.current) return
      setData(next)
      setError(null)
      if (cacheKey) writePollCache(cacheKey, next)
    } catch (e) {
      if (requestId !== requestIdRef.current) return
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [fetcher, cacheKey])

  const patchData = useCallback(
    (updater: (prev: T | null) => T | null) => {
      ++requestIdRef.current
      setData((prev) => {
        const next = updater(prev)
        if (cacheKey && next != null) writePollCache(cacheKey, next)
        return next
      })
      setLoading(false)
    },
    [cacheKey],
  )

  useEffect(() => {
    if (!cacheKey) return
    const cached = readPollCache<T>(cacheKey)
    if (cached != null) {
      setData(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
  }, [cacheKey])

  useEffect(() => {
    void refresh()
    if (intervalMs === false) return
    const id = globalThis.setInterval(() => void refresh(), intervalMs)
    return () => globalThis.clearInterval(id)
  }, [refresh, intervalMs])

  return { data, error, loading, refresh, patchData }
}
