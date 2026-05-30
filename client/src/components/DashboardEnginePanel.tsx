import { useEffect, useState } from 'react'
import { api, type EngineSettings, type LiveStatus } from '@/api/client'
import { Panel, StatusBadge } from '@/components/app-ui'
import { StakeRestartConfirmDialog } from '@/components/StakeRestartConfirmDialog'
import { Button } from '@/components/ui/button'
import { usePaperTrading } from '@/context/PaperTradingContext'
import { Skeleton } from '@/components/ui/skeleton'
import {
  diffStakeSettings,
  hasPendingStakeChanges,
  stakeSnapshotFromSettings,
} from '@/lib/engineStakeSettings'
import { cn } from '@/lib/utils'

const sectionClass =
  'flex min-w-0 flex-col justify-center px-3 py-2 sm:min-w-[6.75rem] sm:px-4 sm:py-3'

const labelClass =
  'text-[11px] font-medium uppercase tracking-wider text-muted-foreground'

interface Props {
  settings: EngineSettings | null
  onSettingsSaved?: (settings: EngineSettings) => void
  onUpdated: () => void | Promise<void>
  className?: string
}

export function DashboardEnginePanel({
  settings,
  onSettingsSaved,
  onUpdated,
  className,
}: Props) {
  const { paperTradingEnabled } = usePaperTrading()
  const [busy, setBusy] = useState(false)
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null)

  useEffect(() => {
    if (settings == null) {
      setLiveStatus(null)
      return
    }
    let cancelled = false
    void api<LiveStatus>('/api/engine/live-status')
      .then((s) => {
        if (!cancelled) setLiveStatus(s)
      })
      .catch(() => {
        if (!cancelled) setLiveStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [settings?.updatedAt])

  const sectionCount = paperTradingEnabled ? 2 : 1

  if (!settings) {
    return (
      <Panel
        className={cn(
          'flex min-h-0 w-full max-w-full shrink-0 flex-row divide-x divide-border sm:min-h-[7.25rem] sm:w-fit',
          className,
        )}
      >
        {Array.from({ length: sectionCount }, (_, i) => (
          <div
            key={i}
            className={cn(
              sectionClass,
              'gap-2',
            )}
          >
            <Skeleton shimmer={false} className="h-3 w-12 rounded" />
            <Skeleton shimmer={false} className="h-8 w-20 rounded-lg" />
          </div>
        ))}
      </Panel>
    )
  }

  const isPaper = paperTradingEnabled && settings.tradingMode === 'Paper'
  const isLive = !isPaper
  const isRunning = settings.isRunning
  const liveReady = liveStatus?.clobConfigured && liveStatus?.canTrade
  const canStart = !isLive || !!liveReady
  const tradingModes = paperTradingEnabled
    ? (['Paper', 'Live'] as const)
    : (['Live'] as const)
  const pendingStake = hasPendingStakeChanges(settings)
  const stakeRestartChanges = pendingStake
    ? diffStakeSettings(
        stakeSnapshotFromSettings(settings, 'active'),
        stakeSnapshotFromSettings(settings, 'pending'),
      )
    : []

  async function update(patch: Record<string, unknown>) {
    if (
      typeof patch.isRunning === 'boolean' &&
      settings != null &&
      patch.isRunning !== settings.isRunning
    ) {
      onSettingsSaved?.({ ...settings, isRunning: patch.isRunning })
    }

    setBusy(true)
    try {
      const saved = await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      onSettingsSaved?.(saved)
      await onUpdated()
    } catch {
      await onUpdated()
    } finally {
      setBusy(false)
    }
  }

  async function setEngineRunning(next: boolean) {
    if (next && pendingStake) {
      setRestartDialogOpen(true)
      return
    }
    await update({ isRunning: next })
  }

  async function confirmStakeRestart() {
    if (settings != null) {
      onSettingsSaved?.({ ...settings, isRunning: true })
    }
    setBusy(true)
    try {
      const saved = await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify({ isRunning: true }),
      })
      setRestartDialogOpen(false)
      onSettingsSaved?.(saved)
      await onUpdated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel
        className={cn(
          'flex min-h-0 w-full min-w-0 max-w-full shrink-0 flex-row flex-nowrap items-stretch divide-x divide-border sm:min-h-[7.25rem] sm:w-fit',
          className,
        )}
      >
        {paperTradingEnabled ? (
          <div className={cn(sectionClass, 'min-w-0 flex-1 sm:min-w-[8.5rem] sm:flex-none')}>
            <p className={labelClass}>Mode</p>
            <div
              className="mt-1.5 flex w-full max-w-none rounded-lg border border-border bg-background p-0.5 sm:mt-2 sm:max-w-[8.5rem]"
              role="group"
              aria-label="Trading mode"
            >
              {tradingModes.map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => update({ tradingMode: mode })}
                  className={cn(
                    'flex-1',
                    settings.tradingMode === mode
                      ? mode === 'Paper'
                        ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
                        : 'bg-warn/15 text-warn hover:bg-warn/20 hover:text-warn'
                      : 'text-muted-foreground',
                  )}
                >
                  {mode}
                </Button>
              ))}
            </div>
            {isLive ? (
              <p
                className="mt-1 hidden max-w-[9.5rem] text-xs leading-snug text-warn sm:block sm:mt-1.5"
                title="Live mode places real Polymarket orders when CLOB is configured."
              >
                {liveStatus?.clobConfigured
                  ? liveStatus.canTrade
                    ? `USDC $${liveStatus.liveBalanceUsd?.toFixed(2) ?? '—'}`
                    : 'Low USDC balance'
                  : 'Set POLYMARKET_PRIVATE_KEY'}
              </p>
            ) : (
              <p className="mt-1 hidden text-xs text-muted-foreground sm:block sm:mt-1.5">
                Simulated fills
                {liveStatus?.clobConfigured && liveStatus.liveBalanceUsd != null
                  ? ` · wallet $${liveStatus.liveBalanceUsd.toFixed(2)}`
                  : ''}
              </p>
            )}
          </div>
        ) : null}

        <div className={cn(sectionClass, 'min-w-0 flex-1 sm:min-w-[7.5rem] sm:flex-none')}>
          <div className="flex items-center gap-2">
            <p className={labelClass}>Engine</p>
            <StatusBadge
              tone={isRunning ? 'live' : 'neutral'}
              className="shrink-0"
            >
              {isRunning ? 'On' : 'Off'}
            </StatusBadge>
          </div>
          <Button
            type="button"
            variant={isRunning ? 'destructive' : 'success'}
            size="sm"
            disabled={busy || !canStart}
            onClick={() => void setEngineRunning(!isRunning)}
            className="mt-1.5 w-full min-w-0 sm:mt-2 sm:min-w-[5.5rem] sm:w-auto"
            title={
              !canStart && isLive
                ? 'Configure Polymarket credentials and fund wallet'
                : undefined
            }
          >
            {isRunning ? 'Stop' : 'Start'}
          </Button>
          {!canStart && isPaper ? (
            <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
              No paper account
            </p>
          ) : null}
        </div>
      </Panel>

      <StakeRestartConfirmDialog
        open={restartDialogOpen}
        changes={stakeRestartChanges}
        busy={busy}
        onConfirm={() => void confirmStakeRestart()}
        onCancel={() => setRestartDialogOpen(false)}
      />
    </>
  )
}
