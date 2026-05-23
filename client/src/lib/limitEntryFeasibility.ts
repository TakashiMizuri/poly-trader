import type { LimitEntryPreview } from '@/api/client'
import type { StakeSnapshot } from '@/lib/engineStakeSettings'
import {
  BALANCE_FLOOR,
  resolveBetStakeForBalance,
  resolveRequestedBetStake,
} from '@/utils/chart/safeBetStake'
import {
  DEFAULT_TREND_BET_STRATEGY_PARAMS,
  type TrendBetStrategyParams,
} from '@/types/trendBetStrategy'

export const MIN_LIMIT_ORDER_SHARES = 5

export function minLimitStakeUsd(bid: number): number {
  if (!Number.isFinite(bid) || bid <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil(MIN_LIMIT_ORDER_SHARES * bid * 100) / 100
}

export function minBalanceForPercentNoBump(
  bid: number,
  stakePercent: number,
): number | null {
  if (stakePercent <= 0) return null
  const minStake = minLimitStakeUsd(bid)
  if (!Number.isFinite(minStake)) return null
  return Math.ceil((minStake / (stakePercent / 100)) * 100) / 100
}

export function minBalanceForOneLimitTrade(bid: number): number {
  const minStake = minLimitStakeUsd(bid)
  if (!Number.isFinite(minStake)) return Number.POSITIVE_INFINITY
  return Math.ceil((minStake + BALANCE_FLOOR) * 100) / 100
}

export function minBalanceForConfiguredStake(
  bid: number,
  snapshot: StakeSnapshot,
): number | null {
  const minStake = minLimitStakeUsd(bid)
  if (!Number.isFinite(minStake)) return null
  if (
    snapshot.maxBetStakeUsd != null &&
    snapshot.maxBetStakeUsd > 0 &&
    snapshot.maxBetStakeUsd + 0.001 < minStake
  ) {
    return null
  }
  if (snapshot.mode === 'percent') {
    return minBalanceForPercentNoBump(bid, snapshot.betStakePercent)
  }
  const requiredStake = Math.max(minStake, snapshot.betStakeUsd)
  return Math.ceil((requiredStake + BALANCE_FLOOR) * 100) / 100
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatStakePercentOfBalance(
  stakeUsd: number,
  balanceUsd: number,
): string | null {
  if (!Number.isFinite(balanceUsd) || balanceUsd <= 0) return null
  const pct = (stakeUsd / balanceUsd) * 100
  if (!Number.isFinite(pct)) return null
  return `${pct.toFixed(2)}%`
}

function formatConfiguredSizingLabel(preview: LimitEntryPreview): string {
  if (preview.stakePercent != null) {
    return `${preview.stakePercent}%`
  }
  if (preview.stakeUsd != null) {
    return formatUsd(preview.stakeUsd)
  }
  return 'configured'
}

function formatBumpSizingSuffix(preview: LimitEntryPreview): string {
  if (preview.balanceUsd == null) return ''
  const effectivePct = formatStakePercentOfBalance(
    preview.effectiveStakeUsd,
    preview.balanceUsd,
  )
  return effectivePct ? ` (${effectivePct})` : ''
}

function minBalanceLines(preview: LimitEntryPreview): string[] {
  const lines: string[] = []
  const one = preview.minBalanceOneTradeUsd
  const configured = preview.minBalanceConfiguredUsd

  if (one != null && Number.isFinite(one)) {
    lines.push(`Min balance (1 limit trade, with bump): ${formatUsd(one)}.`)
  }

  if (configured == null) {
    if (
      preview.maxBetStakeUsd != null &&
      preview.clobMinStakeUsd != null &&
      preview.maxBetStakeUsd + 0.001 < preview.clobMinStakeUsd
    ) {
      lines.push(
        `Cap $${preview.maxBetStakeUsd.toFixed(2)} is below limit min $${preview.clobMinStakeUsd.toFixed(2)} — raise cap or use Market.`,
      )
    }
  } else if (preview.stakePercent != null) {
    lines.push(
      `Min balance (${preview.stakePercent}% without bump): ${formatUsd(configured)}.`,
    )
  } else if (preview.stakeUsd != null) {
    const minStake = preview.clobMinStakeUsd
    if (minStake != null && preview.stakeUsd + 0.001 < minStake) {
      lines.push(
        `Min balance (fixed $${preview.stakeUsd.toFixed(2)} without bump): ${formatUsd(configured)} — or raise fixed stake to ≥ ${formatUsd(minStake)}.`,
      )
    } else {
      lines.push(
        `Min balance (fixed $${preview.stakeUsd.toFixed(2)}): ${formatUsd(configured)}.`,
      )
    }
  } else {
    lines.push(`Min balance (your sizing, no bump): ${formatUsd(configured)}.`)
  }

  if (
    preview.balanceUsd != null &&
    one != null &&
    preview.balanceUsd + 0.01 < one
  ) {
    lines.push(
      `Current balance ${formatUsd(preview.balanceUsd)} is below the one-trade minimum.`,
    )
  } else if (
    preview.balanceUsd != null &&
    configured != null &&
    preview.balanceUsd + 0.01 < configured
  ) {
    lines.push(
      `Current balance ${formatUsd(preview.balanceUsd)} is below the no-bump minimum.`,
    )
  }

  return lines
}

function stakeParamsFromSnapshot(
  balance: number,
  snapshot: StakeSnapshot,
): TrendBetStrategyParams {
  return {
    startBalance: balance,
    betStakeMode: snapshot.mode,
    betStake: snapshot.betStakeUsd,
    betStakePercent: snapshot.betStakePercent,
    maxBetStakeUsd: snapshot.maxBetStakeUsd,
    commissionPercent: 0,
    blendFade2: DEFAULT_TREND_BET_STRATEGY_PARAMS.blendFade2,
  }
}

export function planLimitEntryStake(
  balance: number,
  snapshot: StakeSnapshot,
  bid: number,
): {
  requestedStakeUsd: number
  effectiveStakeUsd: number
  clobMinStakeUsd: number
  canTrade: boolean
  willBump: boolean
  blockReason: string | null
} {
  const params = stakeParamsFromSnapshot(balance, snapshot)
  const requested =
    resolveBetStakeForBalance(balance, params) ??
    resolveRequestedBetStake(balance, params)
  const clobMinStakeUsd = minLimitStakeUsd(bid)
  const maxAffordable = balance - BALANCE_FLOOR

  if (maxAffordable + 0.001 < clobMinStakeUsd) {
    return {
      requestedStakeUsd: requested,
      effectiveStakeUsd: 0,
      clobMinStakeUsd,
      canTrade: false,
      willBump: false,
      blockReason: `Need ≥ $${clobMinStakeUsd.toFixed(2)} for ${MIN_LIMIT_ORDER_SHARES} shares @ bid ${bid.toFixed(2)}`,
    }
  }

  if (requested + 0.001 >= clobMinStakeUsd) {
    let capped = requested
    if (snapshot.maxBetStakeUsd != null && snapshot.maxBetStakeUsd > 0) {
      capped = Math.min(capped, snapshot.maxBetStakeUsd)
    }
    capped = Math.min(capped, maxAffordable)
    if (capped + 0.001 >= clobMinStakeUsd) {
      return {
        requestedStakeUsd: requested,
        effectiveStakeUsd: capped,
        clobMinStakeUsd,
        canTrade: true,
        willBump: false,
        blockReason: null,
      }
    }
  }

  let bumped = Math.min(clobMinStakeUsd, maxAffordable)
  if (snapshot.maxBetStakeUsd != null && snapshot.maxBetStakeUsd > 0) {
    bumped = Math.min(bumped, snapshot.maxBetStakeUsd)
  }

  if (bumped + 0.001 >= clobMinStakeUsd) {
    return {
      requestedStakeUsd: requested,
      effectiveStakeUsd: bumped,
      clobMinStakeUsd,
      canTrade: true,
      willBump: requested + 0.001 < clobMinStakeUsd,
      blockReason: null,
    }
  }

  return {
    requestedStakeUsd: requested,
    effectiveStakeUsd: 0,
    clobMinStakeUsd,
    canTrade: false,
    willBump: false,
    blockReason: `Cap or balance blocks ≥ $${clobMinStakeUsd.toFixed(2)} for ${MIN_LIMIT_ORDER_SHARES} shares`,
  }
}

export type LimitFeasibilityTone = 'ok' | 'warn' | 'error' | 'muted'

export function limitFeasibilityFromPreview(
  preview: LimitEntryPreview | null,
  loading: boolean,
  error: string | null,
): { tone: LimitFeasibilityTone; lines: string[] } {
  if (loading) {
    return { tone: 'muted', lines: ['Checking limit entry requirements…'] }
  }
  if (error) {
    return { tone: 'error', lines: [error] }
  }
  if (!preview) {
    return { tone: 'muted', lines: ['Limit preview unavailable.'] }
  }
  if (preview.referenceBid == null) {
    return {
      tone: 'muted',
      lines: [
        preview.bidUnavailableReason ?? 'Bid price unavailable for preview.',
      ],
    }
  }

  const bid = preview.referenceBid
  const minStake = preview.clobMinStakeUsd ?? minLimitStakeUsd(bid)
  const lines: string[] = [
    `Maker min: ${preview.minOrderShares} shares · ~$${minStake.toFixed(2)} @ bid ${bid.toFixed(2)} (0% fee).`,
    ...minBalanceLines(preview),
  ]

  if (preview.balanceUsd == null) {
    lines.push('Current balance unavailable for preview.')
    return { tone: 'muted', lines }
  }

  lines.push(
    `Current ${formatUsd(preview.balanceUsd)} · next stake ~$${preview.requestedStakeUsd.toFixed(2)}.`,
  )

  if (!preview.canTrade) {
    lines.push(preview.blockReason ?? 'Cannot place limit entry at current settings.')
    return { tone: 'error', lines }
  }

  if (preview.willBump) {
    lines.push(
      `Stake will bump to $${preview.effectiveStakeUsd.toFixed(2)} (above your ${formatConfiguredSizingLabel(preview)} sizing${formatBumpSizingSuffix(preview)}).`,
    )
    return { tone: 'warn', lines }
  }

  lines.push(`Next limit entry ~$${preview.effectiveStakeUsd.toFixed(2)} — no bump.`)

  return { tone: 'ok', lines }
}
