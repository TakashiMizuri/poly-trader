import type { StatusBadgeTone } from '@/components/app-ui'
import { formatDisplayDateTime, formatDisplayMarketWindowSlot } from '@/lib/displayLocale'
import type { TimeFormat } from '@/lib/timeFormat'

/** One maker limit wave when opening a live position. */
export interface PositionEntryWave {
  wave: number
  label?: string | null
  requestedUsd: number
  filledUsd: number
  fillPercent: number
  entryPrice?: number | null
  orderId?: string | null
}

export interface PositionFeedFill {
  id: string
  timeMs: number
  side?: string | null
  stakeUsd?: number | null
  /** Requested notional when live fill was partial. */
  requestedStakeUsd?: number | null
  isPartialFill?: boolean
  entryPrice?: number | null
  entryShares?: number | null
  /** Live maker entry breakdown (attempt 1 / remainder attempt 2). */
  entryWaves?: PositionEntryWave[] | null
  mode?: string | null
  result: string
  skipReason?: string | null
  won?: boolean | null
  pnlUsd?: number | null
  polymarketOrderId?: string | null
  /** Live win awaiting on-chain CTF redeem. */
  awaitingRedeem?: boolean
  /** Patience window start (unix ms) while waiting for entry. */
  entryWaitStartedMs?: number | null
  /** Patience window end (unix ms). */
  entryWaitExpiresMs?: number | null
}

/** Polymarket BTC 5m event length. */
export const BTC_5M_WINDOW_MS = 5 * 60 * 1000

export interface PositionFeedGroup {
  key: string
  marketTitle: string
  marketImageUrl?: string | null
  marketSlug?: string | null
  windowStartMs: number
  windowEndMs: number
  completed: boolean
  /** True once the 5m window has started (progress may run). */
  windowStarted?: boolean
  /** True before window start — progress stays at 0. */
  scheduled?: boolean
  isPrimary?: boolean
  /** Injected next BTC 5m window from Gamma discovery. */
  isUpcoming?: boolean
  isLive?: boolean
  fills: PositionFeedFill[]
}

/** True while the window has not started yet (compact card). */
export function isUpcomingCompactGroup(
  group: PositionFeedGroup,
  nowMs: number = Date.now(),
): boolean {
  if (group.completed) return false
  if (group.windowStartMs > nowMs) return true
  return Boolean(group.isUpcoming && group.scheduled)
}

export function hasExpandedOpenPositionGroups(
  groups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): boolean {
  return groups.some((g) => !g.completed && !isUpcomingCompactGroup(g, nowMs))
}

/** True when a future window (not started yet) is already in the feed. */
export function hasScheduledUpcomingGroup(
  groups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): boolean {
  return groups.some(
    (g) =>
      !g.completed &&
      g.windowEndMs > g.windowStartMs &&
      g.windowStartMs > nowMs,
  )
}

/**
 * When the live window rolls, Gamma/feed may lag — inject the next 5m slot so the
 * compact “up next” card appears in sync with the clock.
 */
export function augmentPositionFeedGroups(
  groups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): PositionFeedGroup[] {
  if (hasScheduledUpcomingGroup(groups, nowMs)) {
    return sortPositionFeedGroups(groups)
  }

  const anchor = findUpcomingAnchorGroup(groups, nowMs)
  if (anchor == null) return sortPositionFeedGroups(groups)

  const startMs = anchor.windowEndMs
  const endMs = startMs + BTC_5M_WINDOW_MS
  if (!Number.isFinite(startMs) || endMs <= startMs) {
    return sortPositionFeedGroups(groups)
  }

  const synthetic: PositionFeedGroup = {
    key: `upcoming:${startMs}`,
    marketTitle: anchor.marketTitle,
    marketImageUrl: anchor.marketImageUrl,
    marketSlug: anchor.marketSlug,
    windowStartMs: startMs,
    windowEndMs: endMs,
    completed: false,
    scheduled: true,
    isUpcoming: true,
    fills: [],
  }

  return sortPositionFeedGroups([...groups, synthetic])
}

function findUpcomingAnchorGroup(
  groups: PositionFeedGroup[],
  nowMs: number,
): PositionFeedGroup | null {
  const open = groups.filter(
    (g) =>
      !g.completed &&
      g.windowEndMs > g.windowStartMs &&
      g.windowEndMs > nowMs,
  )
  if (open.length === 0) return null

  const active = open.find(
    (g) => g.windowStartMs <= nowMs && g.windowEndMs > nowMs,
  )
  if (active) return active

  return open.sort((a, b) => a.windowStartMs - b.windowStartMs)[0] ?? null
}

/** Upcoming window first, then live primary, then other open, then history. */
export function sortPositionFeedGroups(groups: PositionFeedGroup[]): PositionFeedGroup[] {
  const rank = (g: PositionFeedGroup): number => {
    if (g.isUpcoming || (g.scheduled && !g.completed)) return 0
    if (!g.completed && g.isPrimary) return 1
    if (!g.completed) return 2
    return 3
  }
  return [...groups].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return (b.windowStartMs ?? 0) - (a.windowStartMs ?? 0)
  })
}

const SKIP_LABELS: Record<string, string> = {
  engine_stopped: 'Engine stopped',
  no_signal: 'Skip',
  no_market: 'No active market',
  waiting_for_entry: 'Waiting for entry',
  entry_price_out_of_range: 'No entry',
  order_failed: 'Live order failed',
  insufficient_balance: 'Insufficient balance',
  balance_unavailable: 'CLOB balance unavailable',
  clob_min_order_size: 'Below Polymarket min order size (5 shares)',
}

const ENTRY_ERROR_SKIP_REASONS = new Set([
  'order_failed',
  'insufficient_balance',
  'balance_unavailable',
  'no_market',
  'clob_min_order_size',
])

export function isEntryErrorFill(fill: PositionFeedFill): boolean {
  return fill.result === 'Error' || ENTRY_ERROR_SKIP_REASONS.has(fill.skipReason ?? '')
}

export function isWaitingForEntryFill(fill: PositionFeedFill): boolean {
  return fill.result === 'Pending' && fill.skipReason === 'waiting_for_entry'
}

export function isNoEntryFill(fill: PositionFeedFill): boolean {
  return fill.skipReason === 'entry_price_out_of_range'
}

export function waitingEntryLabel(remainingSeconds: number | null): string {
  if (remainingSeconds == null) return 'Waiting for entry'
  return `Waiting for entry · ${Math.max(0, remainingSeconds)}s`
}

export function skipLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return SKIP_LABELS[reason] ?? reason.replaceAll('_', ' ')
}

export function fmtTs(
  tsMs: number | null | undefined,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
) {
  if (tsMs == null || !Number.isFinite(tsMs)) return '—'
  return formatDisplayDateTime(tsMs, timeFormat, useLocalTime)
}

/** Prefix before the ET slot in Gamma titles, e.g. `Bitcoin Up or Down`. */
const UP_DOWN_TITLE_PREFIX_RE = /^(.+?\s+Up or Down)\s*[-–—]\s*/i

/**
 * Rebuild Polymarket "Up or Down" titles using app time format (and local timezone)
 * instead of the fixed `12:35PM-12:40PM ET` string from the API.
 */
export function formatPositionMarketTitle(
  rawTitle: string | null | undefined,
  windowStartMs: number | null | undefined,
  windowEndMs: number | null | undefined,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  const trimmed = rawTitle?.trim()
  if (!trimmed) return 'Unknown market'

  const start =
    windowStartMs != null && Number.isFinite(windowStartMs) ? windowStartMs : null
  const end = windowEndMs != null && Number.isFinite(windowEndMs) ? windowEndMs : null
  if (start != null && end != null && end > start) {
    const prefixMatch = UP_DOWN_TITLE_PREFIX_RE.exec(trimmed)
    const prefix = prefixMatch?.[1]?.trim() ?? trimmed.split(/\s*[-–—]\s/)[0]?.trim() ?? trimmed
    const slot = formatDisplayMarketWindowSlot(start, end, timeFormat, useLocalTime)
    return `${prefix} - ${slot}`
  }

  return trimmed
}

export function eventProgressPercent(
  startMs: number | null,
  endMs: number | null,
  nowMs: number = Date.now(),
): number | null {
  if (startMs == null || endMs == null) return null
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  if (nowMs <= startMs) return 0
  if (nowMs >= endMs) return 1
  return (nowMs - startMs) / (endMs - startMs)
}

/** Compact countdown, e.g. `2:05` or `45s`. */
export function formatDurationShort(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min > 0) return `${min}:${sec.toString().padStart(2, '0')}`
  return `${sec}s`
}

export function formatWindowProgressLabel(
  progressPct: number,
  remainingMs: number | null,
  phase: 'completed' | 'scheduled' | 'active' | 'unknown',
): string {
  const pct = Math.round(progressPct * 100)
  if (phase === 'scheduled' && remainingMs != null) {
    return `Starts in ${formatDurationShort(remainingMs)}`
  }
  if (phase === 'active' && remainingMs != null) {
    return `${pct}% · ${formatDurationShort(remainingMs)} left`
  }
  if (phase === 'completed') return 'Ended'
  return `${pct}%`
}

export function groupHasOpenBet(group: PositionFeedGroup): boolean {
  return group.fills.some((f) => f.result === 'Open')
}

export function primaryOpenFill(group: PositionFeedGroup): PositionFeedFill | null {
  if (!group.isPrimary) return null
  return group.fills.find((f) => f.result === 'Open') ?? null
}

/** Open fill for the live window (includes card that just left compact/upcoming). */
export function liveOpenFill(
  group: PositionFeedGroup,
  nowMs: number = Date.now(),
): PositionFeedFill | null {
  if (group.completed) return null
  const { windowStartMs, windowEndMs } = group
  if (windowEndMs > windowStartMs && nowMs >= windowEndMs) return null
  if (windowStartMs > nowMs) return null
  return group.fills.find((f) => f.result === 'Open') ?? null
}

function fillOverlapsWindow(
  fill: PositionFeedFill,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  if (windowEndMs <= windowStartMs) return false
  const t = fill.timeMs
  return t >= windowStartMs && t < windowEndMs
}

function groupsShareLiveWindow(
  a: PositionFeedGroup,
  b: PositionFeedGroup,
): boolean {
  if (
    a.windowStartMs === b.windowStartMs &&
    a.windowEndMs === b.windowEndMs
  ) {
    return true
  }
  const open = b.fills.find((f) => f.result === 'Open')
  return open != null && fillOverlapsWindow(open, a.windowStartMs, a.windowEndMs)
}

function isStrategySkipFill(fill: PositionFeedFill): boolean {
  return fill.result === 'Skipped' && !isEntryErrorFill(fill)
}

/**
 * Open fill for a live primary card, including bets grouped under another feed key
 * (candle vs Polymarket window start mismatch).
 */
export function resolveDisplayedOpenFill(
  group: PositionFeedGroup,
  allGroups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): PositionFeedFill | null {
  const direct = liveOpenFill(group, nowMs) ?? primaryOpenFill(group)
  if (direct) return direct

  for (const other of allGroups) {
    if (other.key === group.key) continue
    const fill = other.fills.find((f) => f.result === 'Open')
    if (fill && groupsShareLiveWindow(group, other)) return fill
  }

  return null
}

/**
 * Strategy skip (e.g. no_signal) for the live window, including fills grouped under
 * a sibling key when candle time and Polymarket window start differ.
 */
export function resolveDisplayedWaitingFill(
  group: PositionFeedGroup,
  allGroups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): PositionFeedFill | null {
  if (group.completed) return null
  const { windowStartMs, windowEndMs } = group
  if (windowEndMs <= windowStartMs || windowStartMs > nowMs || nowMs >= windowEndMs) {
    return null
  }

  const local = group.fills.find(isWaitingForEntryFill)
  if (local) return local

  for (const other of allGroups) {
    if (other.key === group.key) continue
    const fill = other.fills.find(isWaitingForEntryFill)
    if (fill == null) continue
    if (
      fillOverlapsWindow(fill, windowStartMs, windowEndMs)
      || groupsShareLiveWindow(group, other)
    ) {
      return fill
    }
  }

  return null
}

export function resolveDisplayedSkipFill(
  group: PositionFeedGroup,
  allGroups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): PositionFeedFill | null {
  if (group.completed) return null
  const { windowStartMs, windowEndMs } = group
  if (windowEndMs <= windowStartMs || windowStartMs > nowMs || nowMs >= windowEndMs) {
    return null
  }

  const local = group.fills.find(isStrategySkipFill)
  if (local) return local

  for (const other of allGroups) {
    if (other.key === group.key) continue
    const fill = other.fills.find(isStrategySkipFill)
    if (fill == null) continue
    if (
      fillOverlapsWindow(fill, windowStartMs, windowEndMs)
      || groupsShareLiveWindow(group, other)
    ) {
      return fill
    }
  }

  return null
}

/** Fills to render for a card (may borrow open/skip fills from a sibling group). */
export function resolveDisplayedFills(
  group: PositionFeedGroup,
  allGroups: PositionFeedGroup[],
  nowMs: number = Date.now(),
): PositionFeedFill[] {
  if (group.fills.length > 0) return group.fills
  const borrowedOpen = resolveDisplayedOpenFill(group, allGroups, nowMs)
  if (borrowedOpen) return [borrowedOpen]
  const borrowedWait = resolveDisplayedWaitingFill(group, allGroups, nowMs)
  if (borrowedWait) return [borrowedWait]
  const borrowedSkip = resolveDisplayedSkipFill(group, allGroups, nowMs)
  return borrowedSkip ? [borrowedSkip] : []
}

export function formatGroupTimeRange(
  group: PositionFeedGroup,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  const { windowStartMs, windowEndMs } = group
  if (windowStartMs && windowEndMs && windowEndMs > windowStartMs) {
    return windowStartMs === windowEndMs
      ? fmtTs(windowStartMs, timeFormat, useLocalTime)
      : `${fmtTs(windowStartMs, timeFormat, useLocalTime)} – ${fmtTs(windowEndMs, timeFormat, useLocalTime)}`
  }
  const times = group.fills.map((f) => f.timeMs)
  if (times.length === 0) return '—'
  const max = Math.max(...times)
  const min = Math.min(...times)
  return max === min
    ? fmtTs(max, timeFormat, useLocalTime)
    : `${fmtTs(min, timeFormat, useLocalTime)} – ${fmtTs(max, timeFormat, useLocalTime)}`
}

export function formatGroupSides(fills: PositionFeedFill[]): string {
  const counts = new Map<string, number>()
  for (const fill of fills) {
    if (!fill.side) continue
    counts.set(fill.side, (counts.get(fill.side) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [side, n] of counts) {
    parts.push(`${n}× ${side}`)
  }
  if (parts.length) return parts.join(', ')
  const errors = fills.filter((f) => isEntryErrorFill(f)).length
  if (errors > 0) return `${errors}× error`
  const skipped = fills.filter((f) => f.result === 'Skipped').length
  if (skipped > 0) return `${skipped}× skipped`
  return `${fills.length} event${fills.length === 1 ? '' : 's'}`
}

export function sideTone(side: string | null | undefined): StatusBadgeTone {
  if (side === 'Up') return 'live'
  if (side === 'Down') return 'danger'
  return 'neutral'
}

export function modeTone(mode: string | null | undefined): StatusBadgeTone {
  if (mode === 'Live') return 'live'
  if (mode === 'Paper') return 'shadow'
  return 'neutral'
}

export function resultTone(fill: PositionFeedFill): StatusBadgeTone {
  if (isWaitingForEntryFill(fill)) return 'warn'
  if (isAwaitingRedeem(fill)) return 'warn'
  if (isEntryErrorFill(fill)) return 'neutral'
  if (fill.result === 'Skipped') {
    return fill.skipReason === 'engine_stopped' ? 'neutral' : 'shadow'
  }
  if (fill.result === 'Open') return 'warn'
  if (fill.result === 'Won') return 'liveMuted'
  if (fill.result === 'Lost') return 'dangerMuted'
  return 'neutral'
}

export function resultLabel(
  fill: PositionFeedFill,
  entryWaitRemainingSeconds?: number | null,
): string {
  if (isWaitingForEntryFill(fill)) {
    return waitingEntryLabel(entryWaitRemainingSeconds ?? null)
  }
  if (isAwaitingRedeem(fill)) {
    const pnl = formatPnl(fill)
    if (fill.result === 'Won' && pnl && pnl !== '—') return pnl
    return 'Redeem'
  }
  if (isEntryErrorFill(fill)) return 'Error'
  if (fill.result === 'Skipped') {
    return skipLabel(fill.skipReason) ?? 'Skipped'
  }
  if (fill.result === 'Open' && fill.mode === 'Paper') return 'Paper (open)'
  if (fill.result === 'Open' && fill.mode === 'Live' && isPartialFill(fill)) return 'Partial'
  if (fill.result === 'Open' && fill.mode === 'Live') return 'Live (open)'
  return fill.result
}

export function resultTitle(fill: PositionFeedFill): string | undefined {
  if (isWaitingForEntryFill(fill)) {
    return 'Watching for a fill at ≤ 0.50 during the 30s patience window'
  }
  if (hasEntryWaves(fill)) {
    const lines = fill.entryWaves!.map((w) => formatEntryWaveLine(w)).join('; ')
    const total =
      fill.requestedStakeUsd != null && fill.stakeUsd != null
        ? ` Total: $${fill.stakeUsd.toFixed(2)} of $${fill.requestedStakeUsd.toFixed(2)}.`
        : ''
    return `Maker entry: ${lines}.${total}`
  }
  if (isPartialFill(fill)) {
    const requested = fill.requestedStakeUsd
    if (requested != null && fill.stakeUsd != null) {
      return `Partial fill: $${fill.stakeUsd.toFixed(2)} of $${requested.toFixed(2)} requested`
    }
    return 'Partial fill: notional below requested size'
  }
  if (isAwaitingRedeem(fill)) {
    const pnl = formatPnl(fill)
    if (pnl && pnl !== '—') {
      return `Won · ${pnl} · awaiting on-chain redeem`
    }
    return 'Awaiting on-chain redeem of winning outcome tokens'
  }
  if (isEntryErrorFill(fill)) {
    return skipLabel(fill.skipReason) ?? 'Entry failed — bet was not opened'
  }
  if (fill.result === 'Skipped') {
    const label = skipLabel(fill.skipReason)
    if (fill.skipReason === 'engine_stopped') {
      return label ?? 'Trading engine is stopped — bet was not placed'
    }
    if (fill.skipReason === 'no_signal') {
      return label ?? 'Strategy skip — no bet this window'
    }
    if (fill.skipReason === 'entry_price_out_of_range') {
      return label ?? 'No entry — price stayed outside allowed band'
    }
    return label ?? undefined
  }
  if (fill.result === 'Won') {
    const pnl = formatPnl(fill)
    return pnl && pnl !== '—' ? `Won · ${pnl}` : 'Won'
  }
  if (fill.result === 'Lost') {
    const pnl = formatPnl(fill)
    return pnl && pnl !== '—' ? `Lost · ${pnl}` : 'Lost'
  }
  if (fill.mode === 'Paper') return 'Simulated fill at live Polymarket prices'
  if (fill.polymarketOrderId) return `Live order ${fill.polymarketOrderId}`
  return undefined
}

export function isPartialFill(fill: PositionFeedFill): boolean {
  if (fill.isPartialFill === true) return true
  const requested = fill.requestedStakeUsd
  const filled = fill.stakeUsd
  return (
    requested != null &&
    filled != null &&
    requested > filled + 0.01
  )
}

export function formatStake(fill: PositionFeedFill): string {
  if (fill.stakeUsd == null) return '—'
  const filled = `$${fill.stakeUsd.toFixed(2)}`
  if (!isPartialFill(fill)) return filled
  const requested = fill.requestedStakeUsd
  if (requested != null && requested > 0) {
    return `${filled} / $${requested.toFixed(2)}`
  }
  return `${filled} (partial)`
}

export function formatEntry(fill: PositionFeedFill): string {
  if (fill.entryPrice == null) return '—'
  return fill.entryPrice.toFixed(4)
}

export function formatEntryShares(fill: PositionFeedFill): string | null {
  const shares =
    fill.entryShares ??
    (fill.stakeUsd != null && fill.entryPrice != null && fill.entryPrice > 0
      ? fill.stakeUsd / fill.entryPrice
      : null)
  if (shares == null || !Number.isFinite(shares)) return null
  return `${shares.toFixed(2)} sh`
}

export type FillEconomicsSegment = {
  text: string
  variant: 'metric' | 'mode'
}

/** Stake · share price · shares · mode (structured for even separator spacing in UI). */
export function fillEconomicsSegments(fill: PositionFeedFill): FillEconomicsSegment[] {
  const segments: FillEconomicsSegment[] = [
    { text: formatStake(fill), variant: 'metric' },
    { text: formatEntry(fill), variant: 'metric' },
  ]
  const shares = formatEntryShares(fill)
  if (shares) segments.push({ text: shares, variant: 'metric' })
  if (fill.mode) segments.push({ text: fill.mode, variant: 'mode' })
  return segments
}

export function formatFillEconomics(fill: PositionFeedFill): string {
  return fillEconomicsSegments(fill)
    .map((s) => s.text)
    .join(' · ')
}

export function hasEntryWaves(fill: PositionFeedFill): boolean {
  return (fill.entryWaves?.length ?? 0) > 0
}

export function formatEntryWaveLine(wave: PositionEntryWave): string {
  const name = wave.label?.trim() || `Attempt ${wave.wave}`
  const pct = Number.isFinite(wave.fillPercent)
    ? Math.round(wave.fillPercent)
    : wave.requestedUsd > 0
      ? Math.round((wave.filledUsd / wave.requestedUsd) * 100)
      : 0
  return `${name} → ${pct}% ($${wave.filledUsd.toFixed(2)}/$${wave.requestedUsd.toFixed(2)})`
}

export function entryWaveTitle(wave: PositionEntryWave): string | undefined {
  const price =
    wave.entryPrice != null && wave.entryPrice > 0
      ? wave.entryPrice.toFixed(4)
      : null
  const order = wave.orderId?.trim()
  if (price && order) return `@ ${price} · order ${order}`
  if (price) return `@ ${price}`
  if (order) return `order ${order}`
  return undefined
}

export function isAwaitingRedeem(fill: PositionFeedFill): boolean {
  return fill.awaitingRedeem === true
}

export function isSettledFill(fill: PositionFeedFill): boolean {
  return fill.result === 'Won' || fill.result === 'Lost'
}

export function formatPnl(fill: PositionFeedFill): string | null {
  if (!isSettledFill(fill)) return null
  if (fill.pnlUsd == null) return '—'
  const abs = Math.abs(fill.pnlUsd).toFixed(2)
  if (fill.pnlUsd >= 0) return `+$${abs}`
  return `-$${abs}`
}

export function pnlBadgeTone(fill: PositionFeedFill): StatusBadgeTone {
  if (fill.pnlUsd == null) return 'neutral'
  if (fill.pnlUsd >= 0) return 'liveMuted'
  return 'dangerMuted'
}
