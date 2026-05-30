import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/app-ui'

export type CheckStatus = 'ok' | 'warn' | 'error' | 'idle'

export type ConnectivityCheck = {
  id: string
  label: string
  status: CheckStatus
  detail?: string
}

const toneClass: Record<CheckStatus, string> = {
  ok: 'bg-emerald-500 shadow-emerald-500/60',
  warn: 'bg-amber-500 shadow-amber-500/60',
  error: 'bg-red-500 shadow-red-500/60',
  idle: 'bg-zinc-500 shadow-zinc-500/40',
}

export function StatusLight({
  label,
  status,
  detail,
}: {
  label: string
  status: CheckStatus
  detail?: string
}) {
  return (
    <div className="flex items-start gap-3 transition-opacity duration-200 hover:opacity-95">
      <span
        className={cn(
          'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_6px] transition-transform duration-300',
          toneClass[status],
          status === 'ok' && 'animate-pulse-live',
          status === 'warn' && 'animate-pulse-warn',
        )}
        title={status}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {detail ? (
          <p
            className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
            title={detail}
          >
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function StatusLightsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Compact header pill — label only; detail shown in native tooltip on hover. */
export function StatusLightCompact({
  label,
  status,
  detail,
}: {
  label: string
  status: CheckStatus
  detail?: string
}) {
  const tooltip = detail?.trim() ? detail : label

  return (
    <div
      className="flex h-6 max-w-[9.5rem] min-w-0 shrink-0 select-none items-center gap-1.5 rounded-md border border-border/50 bg-background/40 px-1.5 sm:max-w-none"
      title={tooltip}
    >
      <span
        className={cn(
          'size-2 shrink-0 self-center rounded-full shadow-[0_0_5px]',
          toneClass[status],
          status === 'ok' && 'animate-pulse-live',
          status === 'warn' && 'animate-pulse-warn',
        )}
        aria-hidden
      />
      <p className="m-0 min-w-0 truncate text-xs font-medium leading-none text-foreground">
        {label}
      </p>
    </div>
  )
}

/** Header dot — status only; label/detail in click tooltip (mobile-friendly). */
export function StatusLightDot({
  label,
  status,
  detail,
}: {
  label: string
  status: CheckStatus
  detail?: string
}) {
  const [tipOpen, setTipOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fullLabel = detail?.trim() ? `${label} — ${detail}` : label

  useEffect(() => {
    if (!tipOpen) return

    const timer = globalThis.setTimeout(() => setTipOpen(false), 2500)
    const onDocClick = (event: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setTipOpen(false)
      }
    }

    document.addEventListener('click', onDocClick)
    return () => {
      globalThis.clearTimeout(timer)
      document.removeEventListener('click', onDocClick)
    }
  }, [tipOpen])

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted/60"
        aria-label={fullLabel}
        title={fullLabel}
        onClick={(event) => {
          event.stopPropagation()
          setTipOpen((open) => !open)
        }}
      >
        <span
          className={cn(
            'size-2.5 rounded-full shadow-[0_0_5px]',
            toneClass[status],
            status === 'ok' && 'animate-pulse-live',
            status === 'warn' && 'animate-pulse-warn',
          )}
          aria-hidden
        />
      </button>
      {tipOpen ? (
        <div
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-1 w-max max-w-[14rem] rounded-md border border-border bg-popover px-2 py-1.5 text-left shadow-md"
        >
          <p className="text-xs font-medium leading-snug text-foreground">
            {label}
          </p>
          {detail?.trim() ? (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function StatusHeaderSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          shimmer={false}
          className="size-7 shrink-0 rounded-md"
        />
      ))}
    </>
  )
}

export function StatusLightsList({ checks }: { checks: ConnectivityCheck[] }) {
  return (
    <div className="space-y-4">
      {checks.map((c) => (
        <StatusLight
          key={c.id}
          label={c.label}
          status={c.status}
          detail={c.detail}
        />
      ))}
    </div>
  )
}
