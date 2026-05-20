import {
  normalizeBetStakeMode,
  type BetStakeMode,
  type EngineSettings,
} from '@/api/client'

export type StakeSnapshot = {
  mode: 'percent' | 'fixed'
  betStakePercent: number
  betStakeUsd: number
  maxBetStakeUsd: number | null
}

export function stakeSnapshotFromSettings(
  settings: EngineSettings,
  source: 'pending' | 'active',
): StakeSnapshot {
  if (source === 'active') {
    return {
      mode: normalizeBetStakeMode(
        settings.activeBetStakeMode ?? settings.betStakeMode,
      ),
      betStakePercent:
        settings.activeBetStakePercent ?? settings.betStakePercent,
      betStakeUsd: settings.activeBetStakeUsd ?? settings.betStakeUsd,
      maxBetStakeUsd:
        settings.activeMaxBetStakeUsd !== undefined
          ? settings.activeMaxBetStakeUsd
          : settings.maxBetStakeUsd,
    }
  }

  return {
    mode: normalizeBetStakeMode(settings.betStakeMode),
    betStakePercent: settings.betStakePercent,
    betStakeUsd: settings.betStakeUsd,
    maxBetStakeUsd: settings.maxBetStakeUsd,
  }
}

export function hasPendingStakeChanges(settings: EngineSettings): boolean {
  if (settings.hasPendingStakeChanges) {
    return true
  }

  const active = stakeSnapshotFromSettings(settings, 'active')
  const pending = stakeSnapshotFromSettings(settings, 'pending')
  return (
    active.mode !== pending.mode ||
    active.betStakePercent !== pending.betStakePercent ||
    active.betStakeUsd !== pending.betStakeUsd ||
    active.maxBetStakeUsd !== pending.maxBetStakeUsd
  )
}

function formatMode(mode: BetStakeMode | 'percent' | 'fixed'): string {
  return normalizeBetStakeMode(mode) === 'percent' ? 'Percent of balance' : 'Fixed USD'
}

function formatCap(max: number | null): string {
  return max != null && max > 0 ? `$${max}` : 'No cap'
}

export function formatStakeSnapshot(snapshot: StakeSnapshot): string {
  const mode = formatMode(snapshot.mode)
  const sizing =
    snapshot.mode === 'percent'
      ? `${snapshot.betStakePercent}%`
      : `$${snapshot.betStakeUsd.toFixed(2)}`
  return `${mode} · ${sizing} · cap ${formatCap(snapshot.maxBetStakeUsd)}`
}

export type StakeSettingChange = {
  label: string
  from: string
  to: string
}

export function diffStakeSettings(
  from: StakeSnapshot,
  to: StakeSnapshot,
): StakeSettingChange[] {
  const changes: StakeSettingChange[] = []

  if (from.mode !== to.mode) {
    changes.push({
      label: 'Mode',
      from: formatMode(from.mode),
      to: formatMode(to.mode),
    })
  }

  if (
    from.betStakePercent !== to.betStakePercent ||
    (from.mode !== to.mode && (from.mode === 'percent' || to.mode === 'percent'))
  ) {
    changes.push({
      label: 'Percent',
      from: from.mode === 'percent' ? `${from.betStakePercent}%` : '—',
      to: to.mode === 'percent' ? `${to.betStakePercent}%` : '—',
    })
  }

  if (
    from.betStakeUsd !== to.betStakeUsd ||
    (from.mode !== to.mode && (from.mode === 'fixed' || to.mode === 'fixed'))
  ) {
    changes.push({
      label: 'Amount',
      from: from.mode === 'fixed' ? `$${from.betStakeUsd.toFixed(2)}` : '—',
      to: to.mode === 'fixed' ? `$${to.betStakeUsd.toFixed(2)}` : '—',
    })
  }

  if (from.maxBetStakeUsd !== to.maxBetStakeUsd) {
    changes.push({
      label: 'Cap',
      from: formatCap(from.maxBetStakeUsd),
      to: formatCap(to.maxBetStakeUsd),
    })
  }

  return changes
}
