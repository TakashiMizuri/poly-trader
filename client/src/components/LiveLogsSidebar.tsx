import { PanelRightClose, PanelRightOpen, ScrollText, Trash2, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useTradingLive } from '@/api/tradingLive'
import { Button } from '@/components/ui/button'
import { DESKTOP_LAYOUT_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'
import {
  classifyLogLevel,
  filterLiveLogs,
  LOG_LEVEL_FILTERS,
  readLevelFilterPreference,
  writeLevelFilterPreference,
  type LogLevelFilter,
} from '@/lib/liveLogLevelFilter'
import { cn } from '@/lib/utils'
import type { LiveLogEntry } from '@/types/liveLog'

const OPEN_KEY = 'poly-trader-logs-panel-open'

function readOpenPreference(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function levelClass(level: string): string {
  const normalized = level.toLowerCase()
  if (normalized.includes('error') || normalized.includes('fatal')) {
    return 'text-destructive'
  }
  if (normalized.includes('warn')) {
    return 'text-warn'
  }
  if (normalized.includes('debug') || normalized.includes('verbose')) {
    return 'text-muted-foreground'
  }
  return 'text-foreground/90'
}

function formatLogTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

const LEVEL_FILTER_CHIP_CLASS: Record<LogLevelFilter, string> = {
  INF: 'data-[active=true]:border-border data-[active=true]:bg-muted data-[active=true]:text-foreground',
  WRN: 'text-warn data-[active=true]:border-warn/40 data-[active=true]:bg-warn/15',
  ERR: 'data-[active=true]:border-destructive/40 data-[active=true]:bg-destructive/15 data-[active=true]:text-destructive',
}

function LogLevelFilterBar({
  active,
  onToggle,
}: {
  active: Set<LogLevelFilter>
  onToggle: (level: LogLevelFilter) => void
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5"
      role="group"
      aria-label="Filter by log level"
    >
      {LOG_LEVEL_FILTERS.map((level) => {
        const isActive = active.has(level)
        return (
          <Button
            key={level}
            type="button"
            size="xs"
            variant="outline"
            data-active={isActive}
            aria-pressed={isActive}
            onClick={() => onToggle(level)}
            className={cn(
              'min-w-[2.75rem] font-mono text-[10px] tracking-wide opacity-50 data-[active=true]:opacity-100',
              LEVEL_FILTER_CHIP_CLASS[level],
            )}
          >
            {level}
          </Button>
        )
      })}
    </div>
  )
}

function LogLine({ entry }: { entry: LiveLogEntry }) {
  const shortLevel = entry.level.length > 3 ? entry.level.slice(0, 3).toUpperCase() : entry.level.toUpperCase()
  const isWarning = classifyLogLevel(entry.level) === 'WRN'
  return (
    <div
      className={cn(
        'border-b border-border/40 px-2 py-1.5 font-mono text-[11px] leading-snug last:border-b-0',
        isWarning && 'text-warn',
      )}
    >
      <div className="flex gap-1.5">
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatLogTime(entry.timestamp)}
        </span>
        <span className={cn('shrink-0 font-semibold tabular-nums', levelClass(entry.level))}>
          {shortLevel}
        </span>
        {entry.sourceContext ? (
          <span className="min-w-0 truncate text-muted-foreground" title={entry.sourceContext}>
            {entry.sourceContext.split('.').pop()}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          'mt-0.5 whitespace-pre-wrap break-words',
          isWarning ? 'text-warn' : 'text-foreground/90',
        )}
      >
        {entry.message}
      </p>
      {entry.exception ? (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[10px] text-destructive/90">
          {entry.exception}
        </pre>
      ) : null}
    </div>
  )
}

function LogsPanelBody({
  logs,
  filteredLogs,
  liveConnected,
  levelFilter,
  onToggleLevelFilter,
  scrollRef,
  onScroll,
}: {
  logs: LiveLogEntry[]
  filteredLogs: LiveLogEntry[]
  liveConnected: boolean
  levelFilter: Set<LogLevelFilter>
  onToggleLevelFilter: (level: LogLevelFilter) => void
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
}) {
  return (
    <>
      <LogLevelFilterBar active={levelFilter} onToggle={onToggleLevelFilter} />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {logs.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {liveConnected
              ? 'Waiting for log events…'
              : 'Connect to the API to stream logs.'}
          </p>
        ) : filteredLogs.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No logs match the selected levels.
          </p>
        ) : (
          filteredLogs.map((entry, i) => (
            <LogLine key={`${entry.timestamp}-${i}`} entry={entry} />
          ))
        )}
      </div>
    </>
  )
}

export function LiveLogsSidebar() {
  const { logs, clearLogs, liveConnected } = useTradingLive()
  const isDesktop = useMediaQuery(DESKTOP_LAYOUT_QUERY)
  const [open, setOpen] = useState(readOpenPreference)
  const [levelFilter, setLevelFilter] = useState(readLevelFilterPreference)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const filteredLogs = useMemo(
    () => filterLiveLogs(logs, levelFilter),
    [logs, levelFilter],
  )

  const toggleLevelFilter = useCallback((level: LogLevelFilter) => {
    setLevelFilter((prev) => {
      const next = new Set(prev)
      if (next.has(level)) {
        next.delete(level)
      } else {
        next.add(level)
      }
      writeLevelFilterPreference(next)
      return next
    })
  }, [])

  const setOpenPersisted = useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      /* private mode */
    }
  }, [])

  useEffect(() => {
    if (!open || !stickToBottomRef.current || !scrollRef.current) {
      return
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [filteredLogs, open])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < 48
  }, [])

  useEffect(() => {
    if (!open || isDesktop) {
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, isDesktop])

  const panelBody = (
    <LogsPanelBody
      logs={logs}
      filteredLogs={filteredLogs}
      liveConnected={liveConnected}
      levelFilter={levelFilter}
      onToggleLevelFilter={toggleLevelFilter}
      scrollRef={scrollRef}
      onScroll={onScroll}
    />
  )

  if (!isDesktop) {
    return (
      <>
        {open ? (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-background/80 backdrop-blur-sm"
            role="presentation"
            onClick={() => setOpenPersisted(false)}
          >
            <aside
              className="mt-auto flex max-h-[min(85dvh,640px)] min-h-0 flex-col rounded-t-xl border border-b-0 border-border bg-card shadow-2xl"
              aria-label="Live backend logs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <ScrollText className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate text-sm font-medium">Live logs</span>
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      liveConnected ? 'bg-emerald-500' : 'bg-amber-500',
                    )}
                    title={liveConnected ? 'Streaming' : 'Disconnected'}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={clearLogs}
                    aria-label="Clear logs"
                    title="Clear"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setOpenPersisted(false)}
                    aria-label="Close logs"
                    title="Close"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </div>
              {panelBody}
            </aside>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setOpenPersisted(true)}
          className="fixed bottom-4 right-4 z-40 size-11 rounded-full shadow-lg"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          aria-label="Show live logs"
          title="Live logs"
        >
          <ScrollText className="size-5" aria-hidden />
          <span
            className={cn(
              'absolute right-2.5 top-2.5 size-2 rounded-full ring-2 ring-card',
              liveConnected ? 'bg-emerald-500' : 'bg-amber-500',
            )}
            aria-hidden
          />
        </Button>
      </>
    )
  }

  return (
    <aside
      className={cn(
        'hidden h-full shrink-0 flex-col border-l border-border bg-card/80 backdrop-blur-sm transition-[width] duration-200 ease-out lg:flex',
        open ? 'w-[min(100vw,22rem)]' : 'w-10',
      )}
      aria-label="Live backend logs"
    >
      <div
        className={cn(
          'flex shrink-0 items-center gap-1 border-b border-border px-1 py-1.5',
          open ? 'justify-between px-2' : 'flex-col justify-center',
        )}
      >
        {open ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <ScrollText className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate text-xs font-medium">Live logs</span>
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  liveConnected ? 'bg-emerald-500' : 'bg-amber-500',
                )}
                title={liveConnected ? 'Streaming' : 'Disconnected'}
              />
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={clearLogs}
                aria-label="Clear logs"
                title="Clear"
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpenPersisted(false)}
                aria-label="Hide logs panel"
                title="Hide"
              >
                <PanelRightClose className="size-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpenPersisted(true)}
            className="mx-auto"
            aria-label="Show live logs"
            title="Live logs"
          >
            <PanelRightOpen className="size-4" />
          </Button>
        )}
      </div>

      {open ? panelBody : null}
    </aside>
  )
}
