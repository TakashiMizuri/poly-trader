import { useCallback, useEffect, useState } from 'react'
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

  const refresh = useCallback(async () => {
    try {
      const next = await fetcher()
      setData(next)
      setError(null)
      if (cacheKey) writePollCache(cacheKey, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [fetcher, cacheKey])

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

  return { data, error, loading, refresh }
}
