import { useEffect, useState } from 'react'

/** Default patience window when API timestamps are missing (matches server). */
export const ENTRY_PATIENCE_SECONDS = 30

export type EntryPatienceCountdown = {
  remainingSeconds: number | null
  remainingMs: number | null
  totalSeconds: number
  active: boolean
}

/**
 * Live countdown for the post-open entry patience window (30s → 0).
 */
export function useEntryPatienceCountdown(
  startedMs?: number | null,
  expiresMs?: number | null,
): EntryPatienceCountdown {
  const [nowMs, setNowMs] = useState(() => Date.now())

  const totalSeconds =
    startedMs != null &&
    expiresMs != null &&
    Number.isFinite(startedMs) &&
    Number.isFinite(expiresMs) &&
    expiresMs > startedMs
      ? Math.round((expiresMs - startedMs) / 1000)
      : ENTRY_PATIENCE_SECONDS

  useEffect(() => {
    if (expiresMs == null || !Number.isFinite(expiresMs)) return

    setNowMs(Date.now())
    const tickId = globalThis.setInterval(() => setNowMs(Date.now()), 1000)
    const doneDelay = Math.max(0, expiresMs - Date.now()) + 50
    const doneId = globalThis.setTimeout(() => setNowMs(Date.now()), doneDelay)

    return () => {
      globalThis.clearInterval(tickId)
      globalThis.clearTimeout(doneId)
    }
  }, [startedMs, expiresMs])

  if (expiresMs == null || !Number.isFinite(expiresMs)) {
    return {
      remainingSeconds: null,
      remainingMs: null,
      totalSeconds,
      active: false,
    }
  }

  const remainingMs = Math.max(0, expiresMs - nowMs)
  const remainingSeconds = Math.ceil(remainingMs / 1000)

  return {
    remainingSeconds,
    remainingMs,
    totalSeconds,
    active: remainingMs > 0,
  }
}

export function formatEntryPatienceCountdown(
  remainingSeconds: number | null,
  totalSeconds: number = ENTRY_PATIENCE_SECONDS,
): string {
  if (remainingSeconds == null) return `${totalSeconds}s`
  return `${Math.max(0, remainingSeconds)}s`
}
