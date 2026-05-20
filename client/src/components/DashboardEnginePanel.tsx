import { useState } from 'react'
import {
  api,
  normalizeBetStakeMode,
  type EngineSettings,
} from '@/api/client'
import { Panel, StatusBadge } from '@/components/app-ui'
import { StakeRestartConfirmDialog } from '@/components/StakeRestartConfirmDialog'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/number-input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  diffStakeSettings,
  hasPendingStakeChanges,
  stakeSnapshotFromSettings,
} from '@/lib/engineStakeSettings'
import { cn } from '@/lib/utils'

const sectionClass =
  'flex min-w-0 flex-col justify-center px-4 py-3 sm:min-w-[6.75rem]'

const labelClass =
  'text-[11px] font-medium uppercase tracking-wider text-muted-foreground'

const fieldLabelClass =
  'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'

const stakeBlockClass = 'w-[14rem]'

const stakeNumberClass = 'min-w-[3.25rem] text-sm'

interface Props {
  settings: EngineSettings | null
  onUpdated: () => void
  className?: string
}

export function DashboardEnginePanel({
  settings,
  onUpdated,
  className,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)

  if (!settings) {
    return (
      <Panel
        className={cn(
          'flex min-h-[7.25rem] w-fit shrink-0 divide-x divide-border',
          className,
        )}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              sectionClass,
              'gap-2',
              i === 2 && 'w-fit',
            )}
          >
            <Skeleton shimmer={false} className="h-3 w-12 rounded" />
            <Skeleton
              shimmer={false}
              className={cn('h-8 rounded-lg', i === 2 ? 'w-[14rem]' : 'w-20')}
            />
          </div>
        ))}
      </Panel>
    )
  }

  const isPaper = settings.tradingMode === 'Paper'
  const isLive = settings.tradingMode === 'Live'
  const isRunning = settings.isRunning
  const canStart = !isPaper || !!settings.activePaperAccountId
  const stakeMode = normalizeBetStakeMode(settings.betStakeMode)
  const isPercentStake = stakeMode === 'percent'
  const pendingStake = hasPendingStakeChanges(settings)
  const stakeRestartChanges = pendingStake
    ? diffStakeSettings(
        stakeSnapshotFromSettings(settings, 'active'),
        stakeSnapshotFromSettings(settings, 'pending'),
      )
    : []

  async function update(patch: Record<string, unknown>) {
    setBusy(true)
    try {
      await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      onUpdated()
    } finally {
      setBusy(false)
    }
  }

  async function updateStake(patch: Record<string, unknown>) {
    await update(patch)
  }

  function commitMaxStake(raw: string) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      void updateStake({ clearMaxBetStakeUsd: true })
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n <= 0) {
      void updateStake({ clearMaxBetStakeUsd: true })
      return
    }
    void updateStake({ maxBetStakeUsd: n })
  }

  async function setEngineRunning(next: boolean) {
    if (next && pendingStake) {
      setRestartDialogOpen(true)
      return
    }
    await update({ isRunning: next })
  }

  async function confirmStakeRestart() {
    setBusy(true)
    try {
      await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify({ isRunning: true }),
      })
      setRestartDialogOpen(false)
      onUpdated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel
        className={cn(
          'flex min-h-[7.25rem] w-fit max-w-full shrink-0 flex-wrap items-stretch divide-y divide-border sm:flex-nowrap sm:divide-x sm:divide-y-0',
          className,
        )}
      >
        <div className={cn(sectionClass, 'min-w-[8.5rem]')}>
          <p className={labelClass}>Mode</p>
          <div
            className="mt-2 flex w-full max-w-[8.5rem] rounded-lg border border-border bg-background p-0.5"
            role="group"
            aria-label="Trading mode"
          >
            {(['Paper', 'Live'] as const).map((mode) => (
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
              className="mt-1.5 max-w-[9.5rem] text-xs leading-snug text-warn"
              title="Live mode places real orders when credentials are configured."
            >
              Real orders when credentials are set
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Simulated fills
            </p>
          )}
        </div>

        <div className={cn(sectionClass, 'min-w-[7.5rem]')}>
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
            className="mt-2 w-full min-w-[5.5rem] sm:w-auto"
            title={
              !canStart
                ? 'Select a paper account in settings first'
                : undefined
            }
          >
            {isRunning ? 'Stop' : 'Start'}
          </Button>
          {!canStart && isPaper ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No paper account
            </p>
          ) : null}
        </div>

        <div className={cn(sectionClass, 'w-fit shrink-0')}>
          <div className={stakeBlockClass}>
            <div className="flex items-center justify-between gap-2">
              <p className={labelClass}>Stake</p>
              <div
                className="flex w-[7.25rem] shrink-0 rounded-lg border border-border bg-background p-0.5"
                role="group"
                aria-label="Stake sizing mode"
              >
                {(
                  [
                    { id: 'percent' as const, label: '%' },
                    { id: 'fixed' as const, label: 'Fixed' },
                  ] as const
                ).map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      updateStake({
                        betStakeMode: id === 'percent' ? 'percent' : 'fixed',
                      })
                    }
                    className={cn(
                      'flex-1 px-2',
                      stakeMode === id
                        ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-[6.5rem_6.75rem] gap-x-2.5 gap-y-1">
              <span className={fieldLabelClass}>
                {isPercentStake ? 'Percent' : 'Amount'}
              </span>
              <span className={fieldLabelClass}>Cap</span>

              {isPercentStake ? (
                <NumberInput
                  key={`pct-${settings.updatedAt}`}
                  min={0.01}
                  max={100}
                  step={0.5}
                  suffix="%"
                  defaultValue={settings.betStakePercent}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n > 0 && n <= 100) {
                      void updateStake({ betStakePercent: n })
                    }
                  }}
                  disabled={busy}
                  className={stakeNumberClass}
                  groupClassName="w-full"
                  aria-label="Stake percent of balance"
                />
              ) : (
                <NumberInput
                  key={`usd-${settings.updatedAt}`}
                  min={0.01}
                  step={0.1}
                  prefix="$"
                  defaultValue={settings.betStakeUsd}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n >= 0.01) {
                      void updateStake({ betStakeUsd: n })
                    }
                  }}
                  disabled={busy}
                  className={stakeNumberClass}
                  groupClassName="w-full"
                  aria-label="Fixed stake in USD"
                />
              )}

              <NumberInput
                key={`max-${settings.updatedAt}`}
                min={0.01}
                step={1}
                prefix="$"
                placeholder="No cap"
                defaultValue={
                  settings.maxBetStakeUsd != null && settings.maxBetStakeUsd > 0
                    ? settings.maxBetStakeUsd
                    : ''
                }
                onBlur={(e) => commitMaxStake(e.target.value)}
                disabled={busy}
                className={cn(
                  stakeNumberClass,
                  'placeholder:text-muted-foreground/60',
                )}
                groupClassName="w-full"
                aria-label="Maximum stake in USD (empty for no cap)"
              />
            </div>

            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              {isPercentStake ? '% of balance per bet' : 'Fixed USD per bet'}
              {isRunning && pendingStake ? (
                <span className="text-warn"> · applies on restart</span>
              ) : null}
            </p>
          </div>
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
