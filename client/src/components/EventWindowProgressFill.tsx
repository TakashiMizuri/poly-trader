import { memo, useMemo } from 'react'

import { eventWindowFillStyle } from '@/hooks/useEventWindowProgress'
import { cn } from '@/lib/utils'

/**
 * CSS-linear fill for the market window. Memoized so parent label ticks
 * do not recalculate animation-delay (that caused visible stutter).
 */
export const EventWindowProgressFill = memo(function EventWindowProgressFill({
  startMs,
  endMs,
  isPrimary,
}: {
  startMs: number
  endMs: number
  isPrimary: boolean
}) {
  const style = useMemo(
    () => eventWindowFillStyle({ startMs, endMs }),
    [startMs, endMs],
  )

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 z-0 w-full [contain:strict] [transform:translateZ(0)]',
        isPrimary ? 'bg-primary/15' : 'bg-primary/10',
      )}
      style={style}
      aria-hidden
    />
  )
})
