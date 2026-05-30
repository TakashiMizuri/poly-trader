import {
  BTC_5M_WINDOW_MS,
  sortPositionFeedGroups,
  type PositionEntryWave,
  type PositionFeedFill,
  type PositionFeedGroup,
} from '@/lib/positionDisplay'

/** Payload from SignalR TradePlaced (matches server TradeEventDtoFactory). */
export interface TradePlacedPayload {
  id: number
  candleTime: number
  side: string
  trend?: string
  mode?: string
  stakeUsd: number
  requestedStakeUsd?: number | null
  isPartialFill?: boolean
  entryPrice: number
  entryShares?: number | null
  entryWaves?: PositionEntryWave[] | null
  won?: boolean | null
  polymarketOrderId?: string | null
  settlementStatus?: string | null
  market?: {
    title?: string
    slug?: string | null
    windowStartUtc?: string | null
    windowEndUtc?: string | null
  } | null
}

export function tradePlacedToFeedFill(trade: TradePlacedPayload): PositionFeedFill {
  const partial =
    trade.isPartialFill === true
    || (trade.requestedStakeUsd != null
      && trade.requestedStakeUsd > trade.stakeUsd + 0.01)
  return {
    id: `trade-${trade.id}`,
    timeMs: trade.candleTime * 1000,
    side: trade.side,
    trend: trade.trend ?? null,
    mode: trade.mode ?? null,
    stakeUsd: trade.stakeUsd,
    requestedStakeUsd: trade.requestedStakeUsd ?? null,
    isPartialFill: partial,
    entryPrice: trade.entryPrice,
    entryShares: trade.entryShares ?? null,
    entryWaves: trade.entryWaves ?? null,
    result: trade.won == null ? 'Open' : trade.won ? 'Won' : 'Lost',
    won: trade.won ?? null,
    polymarketOrderId: trade.polymarketOrderId ?? null,
    settlementStatus: trade.settlementStatus ?? null,
  }
}

function parseWindowEndMs(trade: TradePlacedPayload, windowStartMs: number): number {
  const end = trade.market?.windowEndUtc
  if (end) {
    const parsed = Date.parse(end)
    if (!Number.isNaN(parsed)) return parsed
  }
  return windowStartMs + BTC_5M_WINDOW_MS
}

/** Optimistically merge a new open trade into the positions feed (instant UI). */
export function applyTradePlacedToFeedGroups(
  groups: PositionFeedGroup[] | null,
  trade: TradePlacedPayload,
): PositionFeedGroup[] | null {
  if (groups == null) return null

  const windowStartMs = trade.candleTime * 1000
  const fill = tradePlacedToFeedFill(trade)
  const windowEndMs = parseWindowEndMs(trade, windowStartMs)

  const idx = groups.findIndex((g) => g.windowStartMs === windowStartMs)
  if (idx >= 0) {
    const g = groups[idx]!
    const fills = [
      ...g.fills.filter(
        (f) => f.id !== fill.id && f.skipReason !== 'waiting_for_entry',
      ),
      fill,
    ]
    const next = [...groups]
    next[idx] = {
      ...g,
      fills,
      completed: false,
      windowStarted: true,
      scheduled: false,
      isLive: true,
    }
    return sortPositionFeedGroups(next)
  }

  const newGroup: PositionFeedGroup = {
    key: `window:${windowStartMs}`,
    marketTitle: trade.market?.title ?? 'Bitcoin Up or Down',
    marketSlug: trade.market?.slug ?? null,
    windowStartMs,
    windowEndMs,
    completed: false,
    windowStarted: true,
    scheduled: false,
    isLive: true,
    fills: [fill],
  }
  return sortPositionFeedGroups([newGroup, ...groups])
}
