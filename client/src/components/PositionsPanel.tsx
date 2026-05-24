import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { BarChart3 } from 'lucide-react'
import { api } from '@/api/client'
import { usePoll } from '@/api/hooks'
import { EventWindowProgressFill } from '@/components/EventWindowProgressFill'
import { MarketCell } from '@/components/MarketCell'
import { PageCard, Skeleton, StatusBadge } from '@/components/app-ui'
import { TradeStatisticsDialog } from '@/components/TradeStatisticsDialog'
import { Button } from '@/components/ui/button'
import { useEntryPatienceCountdown } from '@/hooks/useEntryPatienceCountdown'
import { useEventWindowProgress } from '@/hooks/useEventWindowProgress'
import { useTimeFormat } from '@/context/TimeFormatContext'
import { polymarketMarketUrl } from '@/lib/polymarket'
import {
  augmentPositionFeedGroups,
  entryWaveTitle,
  fillEconomicsSegments,
  formatEntryWaveLine,
  formatGroupTimeRange,
  formatPositionMarketTitle,
  formatPnl,
  formatStake,
  hasEntryWaves,
  isSettledFill,
  formatWindowProgressLabel,
  groupHasOpenBet,
  modeTone,
  resolveDisplayedFills,
  resolveDisplayedOpenFill,
  resolveDisplayedSkipFill,
  resolveDisplayedWaitingFill,
  isWaitingForEntryFill,
  waitingEntryLabel,
  type PositionFeedFill,
  type PositionFeedGroup,
  sortPositionFeedGroups,
  pnlBadgeTone,
  resultLabel,
  resultTitle,
  resultTone,
  sideTone,
} from '@/lib/positionDisplay'
import { cn } from '@/lib/utils'

/** Card chrome for ended windows (no filter — badges stay in color). */
const completedGroupShellClass = 'border-border/40 bg-muted/25 ring-border/20'

/**
 * Fade card body when a window ends (explicit from/to for CSS transitions).
 * Do not apply on Won/Lost/PnL badges — they stay full color on closed positions.
 */
const positionDimTransitionClass =
  'transition-[opacity,filter] duration-500 ease-out motion-reduce:transition-none'

function positionDimStateClass(dimmed: boolean): string {
  return dimmed
    ? 'opacity-50 grayscale saturate-[0.35] contrast-[0.95]'
    : 'opacity-100 grayscale-0 saturate-100 contrast-100'
}

/** Recompute augment + refresh feed when any window starts or ends. */
function useFeedWindowBoundaries(
  groups: PositionFeedGroup[],
  onBoundary: () => void,
) {
  useEffect(() => {
    const now = Date.now()
    const ids: ReturnType<typeof globalThis.setTimeout>[] = []

    for (const g of groups) {
      const { windowStartMs: start, windowEndMs: end } = g
      if (!start || !end || end <= start) continue
      for (const targetMs of [start, end]) {
        const delay = targetMs - now + 48
        if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
          ids.push(globalThis.setTimeout(onBoundary, delay))
        }
      }
    }

    return () => ids.forEach((id) => globalThis.clearTimeout(id))
  }, [groups, onBoundary])
}

interface Props {
  refreshKey?: number
  paperAccountId?: number | null
  tradingMode?: string
  engineRunning?: boolean
  className?: string
}

function PositionFillRow({
  fill,
  dimmed = false,
  hideTopBorder = false,
}: {
  fill: PositionFeedFill
  dimmed?: boolean
  hideTopBorder?: boolean
}) {
  const pnlLabel = formatPnl(fill)
  const showEntryWaves = hasEntryWaves(fill)
  const waiting = isWaitingForEntryFill(fill)
  const patience = useEntryPatienceCountdown(
    waiting ? fill.entryWaitStartedMs : null,
    waiting ? fill.entryWaitExpiresMs : null,
  )
  const statusLabel = waiting
    ? resultLabel(fill, patience.remainingSeconds)
    : resultLabel(fill)

  return (
    <div
      className={cn(
        !hideTopBorder && 'border-t border-border/40',
      )}
      title={resultTitle(fill)}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2',
            positionDimTransitionClass,
            positionDimStateClass(dimmed),
          )}
        >
          {fill.side ? (
            <StatusBadge tone={sideTone(fill.side)} className="shrink-0">
              {fill.side}
            </StatusBadge>
          ) : null}
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {fillEconomicsSegments(fill).map((segment, index) => (
                <Fragment key={`${segment.variant}-${index}`}>
                  {index > 0 ? (
                    <span className="shrink-0 text-muted-foreground/60" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'shrink-0',
                      segment.variant === 'metric' && 'font-mono tabular-nums',
                      segment.variant === 'mode' &&
                        (modeTone(fill.mode) === 'live' ? 'text-live' : 'text-shadow'),
                    )}
                  >
                    {segment.text}
                  </span>
                </Fragment>
              ))}
            </span>
          </span>
        </div>
        {isSettledFill(fill) && pnlLabel != null && pnlLabel !== '—' ? (
          <StatusBadge
            tone={pnlBadgeTone(fill)}
            title={resultTitle(fill)}
            className="max-w-[9rem] min-w-0 shrink-0 font-mono tabular-nums overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {pnlLabel}
          </StatusBadge>
        ) : (
          <StatusBadge
            tone={resultTone(fill)}
            title={resultTitle(fill)}
            className="max-w-[9rem] min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-mono tabular-nums"
          >
            {statusLabel}
          </StatusBadge>
        )}
      </div>
      {showEntryWaves ? (
        <div
          className={cn(
            'space-y-0.5 border-t border-border/30 bg-muted/10 px-2.5 py-1.5',
            positionDimTransitionClass,
            positionDimStateClass(dimmed),
          )}
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
            Entry (maker)
          </p>
          <ul className="space-y-0.5">
            {fill.entryWaves!.map((wave) => (
              <li
                key={wave.wave}
                className="font-mono text-[11px] tabular-nums text-muted-foreground"
                title={entryWaveTitle(wave)}
              >
                {formatEntryWaveLine(wave)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ExpandableSection({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function PositionFeedSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 px-2.5 py-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-border/50 bg-card/25 px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <Skeleton shimmer={false} className="h-4 w-4 shrink-0 rounded" />
            <Skeleton shimmer={false} className="h-4 min-w-0 flex-1 rounded" />
            <Skeleton shimmer={false} className="h-5 w-14 shrink-0 rounded-md" />
          </div>
          <Skeleton shimmer={false} className="mt-2 h-3 w-40 max-w-[70%] rounded" />
        </div>
      ))}
    </div>
  )
}

function shouldPlayPositionEnterAnim(groupKey: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  const storageKey = `poly-trader-position-enter:${groupKey}`
  try {
    if (sessionStorage.getItem(storageKey)) return false
    sessionStorage.setItem(storageKey, '1')
    return true
  } catch {
    return false
  }
}

function PositionBlock({
  group,
  allGroups,
  engineRunning = false,
}: {
  group: PositionFeedGroup
  allGroups: PositionFeedGroup[]
  engineRunning?: boolean
}) {
  const { timeFormat } = useTimeFormat()
  const eventWindow =
    group.windowStartMs && group.windowEndMs && group.windowEndMs > group.windowStartMs
      ? { startMs: group.windowStartMs, endMs: group.windowEndMs }
      : null
  const settled = group.completed
  const isPrimary = group.isPrimary === true
  const isUpcoming = group.isUpcoming === true
  const { phase, progressPct, remainingMs, ticking } = useEventWindowProgress(
    eventWindow,
    false,
  )
  /** Clock-driven end — do not wait for feed poll to grey out the card. */
  const ended = phase === 'completed'
  const showCompleted = settled || ended
  const isLiveCard = phase === 'active'
  const isCompact = phase === 'scheduled' && !showCompleted
  const showLiveChrome = isLiveCard
  const openFill = resolveDisplayedOpenFill(group, allGroups)
  const skipFill = resolveDisplayedSkipFill(group, allGroups)
  const waitingFill = resolveDisplayedWaitingFill(group, allGroups)
  const patience = useEntryPatienceCountdown(
    waitingFill?.entryWaitStartedMs,
    waitingFill?.entryWaitExpiresMs,
  )
  const displayedFills = resolveDisplayedFills(group, allGroups)
  const hasOpenBet = openFill != null || groupHasOpenBet(group)
  const awaitingEntry =
    engineRunning &&
    isLiveCard &&
    openFill == null &&
    skipFill == null &&
    waitingFill == null
  const progressLabel =
    eventWindow != null
      ? formatWindowProgressLabel(progressPct, remainingMs, phase)
      : null
  const progressTitle = showCompleted
    ? `Ended · ${formatGroupTimeRange(group, timeFormat)}`
    : progressLabel
      ? `${progressLabel} · ${formatGroupTimeRange(group, timeFormat)}`
      : undefined
  const marketUrl = polymarketMarketUrl(group.marketSlug)
  const displayMarketTitle = formatPositionMarketTitle(
    group.marketTitle,
    group.windowStartMs,
    group.windowEndMs,
    timeFormat,
  )
  const playEnterAnim =
    isCompact && isUpcoming && shouldPlayPositionEnterAnim(group.key)
  const statusLine =
    showLiveChrome && openFill
      ? `BTC 5m · ${openFill.side ?? 'open'} ${formatStake(openFill)}`
      : showLiveChrome && waitingFill
        ? `BTC 5m · ${waitingEntryLabel(patience.remainingSeconds)}`
        : showLiveChrome
          ? 'BTC 5m · live'
          : isCompact
            ? 'BTC 5m · up next'
            : 'BTC 5m'

  return (
    <article
      data-phase={phase}
      className={cn(
        'position-block relative overflow-hidden rounded-lg border bg-card/40 ring-1 ring-inset',
        'transition-[opacity,filter,border-color,box-shadow,background-color] duration-500 ease-out motion-reduce:transition-none',
        showCompleted && completedGroupShellClass,
        showCompleted
          ? undefined
          : isCompact
            ? 'border-border/50 ring-border/25 bg-card/25'
            : 'border-border/70 ring-border/30',
        playEnterAnim && 'position-block--enter',
      )}
      title={progressTitle}
      role={ticking ? 'progressbar' : undefined}
      aria-valuemin={ticking ? 0 : undefined}
      aria-valuemax={ticking ? 100 : undefined}
      aria-valuenow={ticking ? Math.round(progressPct * 100) : undefined}
      aria-label={
        showLiveChrome && progressLabel
          ? `Current window · ${progressLabel}`
          : isCompact && progressLabel
            ? `Upcoming window · ${progressLabel}`
            : undefined
      }
    >
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <div
          className={cn(
            'absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none',
            showLiveChrome && eventWindow && !showCompleted
              ? 'opacity-100'
              : 'opacity-0',
          )}
        >
          {showLiveChrome && eventWindow ? (
            <EventWindowProgressFill
              startMs={eventWindow.startMs}
              endMs={eventWindow.endMs}
              isPrimary={isPrimary && isLiveCard}
            />
          ) : isCompact ? (
            <div className="h-full bg-muted/10" />
          ) : null}
        </div>
        <div
          className={cn(
            'absolute inset-0 bg-muted/15 transition-opacity duration-500 ease-out motion-reduce:transition-none',
            showCompleted ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>

      <div className="relative z-[1]">
        <header
          className={cn(
            'flex gap-2 transition-[padding,border-color] duration-500 ease-out motion-reduce:transition-none',
            isCompact && 'items-center',
            isCompact || showLiveChrome
              ? 'py-1.5 pl-2 pr-2'
              : 'border-b border-border/60 py-1.5 pl-2 pr-2',
            positionDimTransitionClass,
            positionDimStateClass(showCompleted),
          )}
        >
          <div
            className={cn(
              'w-1 shrink-0 rounded-full transition-colors duration-500 ease-out motion-reduce:transition-none',
              isCompact ? 'h-6 self-center' : 'self-stretch',
              showCompleted
                ? 'bg-muted-foreground/30'
                : showLiveChrome
                  ? 'bg-primary'
                  : isCompact
                    ? 'bg-muted-foreground/45'
                    : isPrimary && isLiveCard
                      ? 'bg-primary'
                      : 'bg-primary/70',
            )}
            aria-hidden
          />
          <div className={cn('min-w-0 flex-1', !isCompact && 'space-y-1')}>
            <div
              className={cn(
                'flex justify-between gap-2',
                isCompact ? 'items-center' : 'items-start',
              )}
            >
              <MarketCell
                title={displayMarketTitle}
                imageUrl={group.marketImageUrl}
                compact={isCompact}
                className={cn(
                  'min-w-0 flex-1 [&_p]:transition-colors [&_p]:duration-500 [&_p]:ease-out motion-reduce:[&_p]:transition-none',
                  showCompleted
                    ? '[&_p]:text-muted-foreground'
                    : '[&_p]:text-foreground',
                )}
              />
              <div className="flex shrink-0 items-center gap-1.5">
                {!showCompleted && waitingFill ? (
                  <span
                    className="max-w-[42%] shrink truncate rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-400 sm:max-w-none"
                    title={waitingEntryLabel(patience.remainingSeconds)}
                  >
                    {waitingEntryLabel(patience.remainingSeconds)}
                  </span>
                ) : null}
                {!showCompleted && !waitingFill && progressLabel ? (
                  <span
                    className={cn(
                      'max-w-[42%] shrink truncate rounded-md font-mono text-[11px] font-medium tabular-nums sm:max-w-none',
                      isCompact ? 'px-1.5 py-0.5' : 'px-2 py-0.5',
                      showLiveChrome && hasOpenBet
                        ? 'bg-primary/15 text-primary'
                        : isCompact
                          ? 'bg-muted/80 text-foreground'
                          : 'bg-muted text-muted-foreground',
                    )}
                    title={progressTitle}
                  >
                    {progressLabel}
                  </span>
                ) : null}
                {!isCompact && marketUrl ? (
                  <a
                    href={marketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                    aria-label="Open on Polymarket"
                    title="Open on Polymarket"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                ) : null}
              </div>
            </div>

            <ExpandableSection open={!isCompact}>
              <p
                className={cn(
                  'truncate text-xs text-muted-foreground transition-[opacity,color] duration-500 ease-out motion-reduce:transition-none',
                  !isCompact ? 'opacity-100' : 'opacity-0',
                )}
                title={statusLine}
              >
                <span
                  className={cn(
                    'font-medium transition-colors duration-500 ease-out motion-reduce:transition-none',
                    showCompleted ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {statusLine}
                </span>
              </p>
            </ExpandableSection>
          </div>
        </header>

        <ExpandableSection open={!isCompact}>
          <div
            className={cn(
              'transition-opacity duration-500 ease-out motion-reduce:transition-none',
              !isCompact ? 'opacity-100 delay-75' : 'opacity-0',
            )}
          >
            {displayedFills.length === 0 ? (
              <p
                className={cn(
                  'px-2.5 py-2 text-xs text-muted-foreground',
                  positionDimTransitionClass,
                  positionDimStateClass(showCompleted),
                )}
              >
                {waitingFill
                  ? `${waitingEntryLabel(patience.remainingSeconds)} (limit ≤ 0.50)`
                  : awaitingEntry
                  ? 'Awaiting entry (decision at bar open)…'
                  : !engineRunning && isLiveCard && openFill == null && skipFill == null
                    ? 'Engine stopped'
                    : isCompact
                      ? 'Up next — entry when window opens'
                      : 'No activity recorded'}
              </p>
            ) : (
              displayedFills.map((fill, index) => (
                <PositionFillRow
                  key={fill.id}
                  fill={fill}
                  dimmed={showCompleted}
                  hideTopBorder={showLiveChrome && index === 0}
                />
              ))
            )}
          </div>
        </ExpandableSection>
      </div>
    </article>
  )
}

function buildFeedParams(
  paperAccountId?: number | null,
  tradingMode?: string,
): URLSearchParams {
  const params = new URLSearchParams({ limit: '50' })
  if (tradingMode) params.set('mode', tradingMode)
  if (tradingMode === 'Paper' && paperAccountId != null) {
    params.set('paperAccountId', String(paperAccountId))
  }
  return params
}

export function PositionsPanel({
  refreshKey = 0,
  paperAccountId,
  tradingMode,
  engineRunning = false,
  className,
}: Props) {
  const feedParams = useMemo(
    () => buildFeedParams(paperAccountId, tradingMode),
    [paperAccountId, tradingMode],
  )
  const feedCacheKey = useMemo(
    () => `api/trades/feed:${feedParams.toString()}`,
    [feedParams],
  )

  const fetchFeed = useCallback(
    () =>
      api<PositionFeedGroup[]>(`/api/trades/feed?${feedParams}`).then(
        sortPositionFeedGroups,
      ),
    [feedParams],
  )

  const feedPoll = usePoll(fetchFeed, false, { cacheKey: feedCacheKey })
  const rawGroups = feedPoll.data ?? []
  const [feedNowMs, setFeedNowMs] = useState(() => Date.now())
  const groups = useMemo(
    () => augmentPositionFeedGroups(rawGroups, feedNowMs),
    [rawGroups, feedNowMs],
  )
  const feedPending = feedPoll.loading && feedPoll.data == null
  const [statsOpen, setStatsOpen] = useState(false)

  const onWindowBoundary = useCallback(() => {
    setFeedNowMs(Date.now())
    void feedPoll.refresh()
  }, [feedPoll.refresh])

  useEffect(() => {
    void feedPoll.refresh()
  }, [refreshKey, feedPoll.refresh])

  useFeedWindowBoundaries(groups, onWindowBoundary)

  useEffect(() => {
    const hasActive = groups.some(
      (g) => g.isUpcoming || (g.scheduled && !g.completed),
    )
    const pollMs = hasActive ? 5_000 : 15_000
    const id = globalThis.setInterval(() => void feedPoll.refresh(), pollMs)
    return () => globalThis.clearInterval(id)
  }, [groups, feedPoll.refresh])

  return (
    <>
      <PageCard
        title="Position history"
        fill
        className={cn('h-full min-h-0 min-w-0 max-w-full', className)}
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
        action={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setStatsOpen(true)}
            aria-label="Trading statistics"
            title="Statistics"
          >
            <BarChart3 className="size-4" aria-hidden />
          </Button>
        }
      >
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {feedPending ? (
          <PositionFeedSkeleton />
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No Polymarket BTC 5m windows available
          </p>
        ) : (
          <div className="space-y-1.5 px-2.5 py-2">
            {groups.map((group) => (
              <PositionBlock
                key={group.key}
                group={group}
                allGroups={groups}
                engineRunning={engineRunning}
              />
            ))}
          </div>
        )}
      </div>
    </PageCard>
      <TradeStatisticsDialog
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        tradingMode={tradingMode}
        paperAccountId={paperAccountId}
      />
    </>
  )
}
