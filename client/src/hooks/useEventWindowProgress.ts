import { useEffect, useState, type CSSProperties } from 'react'

import { eventProgressPercent } from '@/lib/positionDisplay'

export type EventWindow = { startMs: number; endMs: number }

export type EventWindowPhase = 'completed' | 'scheduled' | 'active' | 'unknown'

/** Label/countdown tick — bar motion is CSS-driven (see `eventWindowFillStyle`). */
const LABEL_TICK_MS = 1_000

export type EventWindowProgress = {
  nowMs: number
  phase: EventWindowPhase
  progress: number | null
  progressPct: number
  remainingMs: number | null
  ticking: boolean
}

function derivePhase(
  eventWindow: EventWindow | null,
  nowMs: number,
  completed: boolean,
): EventWindowPhase {
  if (completed) return 'completed'
  if (!eventWindow) return 'unknown'
  if (nowMs < eventWindow.startMs) return 'scheduled'
  if (nowMs >= eventWindow.endMs) return 'completed'
  return 'active'
}

/**
 * GPU-smooth fill: linear scaleX over the full window, synced via negative delay.
 */
export function eventWindowFillStyle(eventWindow: EventWindow): CSSProperties {
  const durationMs = eventWindow.endMs - eventWindow.startMs
  const elapsedMs = Math.min(
    durationMs,
    Math.max(0, Date.now() - eventWindow.startMs),
  )

  return {
    width: '100%',
    transform: 'scaleX(0)',
    transformOrigin: 'left center',
    willChange: 'transform',
    animation: `event-window-fill ${durationMs}ms linear ${-elapsedMs}ms forwards`,
  }
}

/**
 * Window phase + progress for labels/a11y. Fill bar uses CSS animation, not React width.
 */
export function useEventWindowProgress(
  eventWindow: EventWindow | null,
  completed = false,
): EventWindowProgress {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!eventWindow || completed) return

    setNowMs(Date.now())

    const scheduleBoundary = (targetMs: number) => {
      const delay = Math.max(0, targetMs - Date.now()) + 32
      return globalThis.setTimeout(() => setNowMs(Date.now()), delay)
    }

    const startId = scheduleBoundary(eventWindow.startMs)
    const endId = scheduleBoundary(eventWindow.endMs)
    const tickId = globalThis.setInterval(() => setNowMs(Date.now()), LABEL_TICK_MS)

    return () => {
      globalThis.clearTimeout(startId)
      globalThis.clearTimeout(endId)
      globalThis.clearInterval(tickId)
    }
  }, [eventWindow?.startMs, eventWindow?.endMs, completed])

  const phase = derivePhase(eventWindow, nowMs, completed)
  const ticking = phase === 'active' && eventWindow != null

  const progress = eventWindow
    ? eventProgressPercent(eventWindow.startMs, eventWindow.endMs, nowMs)
    : null

  const progressPct =
    phase === 'completed'
      ? 1
      : phase === 'active' && progress != null
        ? progress
        : 0

  const remainingMs =
    eventWindow == null
      ? null
      : phase === 'scheduled'
        ? Math.max(0, eventWindow.startMs - nowMs)
        : phase === 'active'
          ? Math.max(0, eventWindow.endMs - nowMs)
          : null

  return { nowMs, phase, progress, progressPct, remainingMs, ticking }
}
