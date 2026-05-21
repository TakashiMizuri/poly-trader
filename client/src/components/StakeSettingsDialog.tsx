import { useEffect, useState } from 'react'
import { api, type EngineSettings } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NumberInput } from '@/components/ui/number-input'
import {
  hasPendingStakeChanges,
  stakeSnapshotFromSettings,
  type StakeSnapshot,
} from '@/lib/engineStakeSettings'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  settings: EngineSettings
  onUpdated: () => void
}

type StakeDraft = StakeSnapshot

const fieldLabelClass =
  'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'

function draftFromSettings(settings: EngineSettings): StakeDraft {
  return stakeSnapshotFromSettings(settings, 'pending')
}

function parseMaxCap(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function draftsEqual(a: StakeDraft, b: StakeDraft): boolean {
  return (
    a.mode === b.mode &&
    a.betStakePercent === b.betStakePercent &&
    a.betStakeUsd === b.betStakeUsd &&
    a.maxBetStakeUsd === b.maxBetStakeUsd
  )
}

function isDraftValid(draft: StakeDraft): boolean {
  if (draft.mode === 'percent') {
    return (
      Number.isFinite(draft.betStakePercent) &&
      draft.betStakePercent > 0 &&
      draft.betStakePercent <= 100
    )
  }
  return Number.isFinite(draft.betStakeUsd) && draft.betStakeUsd >= 0.01
}

function buildStakePatch(draft: StakeDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    betStakeMode: draft.mode === 'percent' ? 'percent' : 'fixed',
    betStakePercent: draft.betStakePercent,
    betStakeUsd: draft.betStakeUsd,
  }
  if (draft.maxBetStakeUsd == null) {
    patch.clearMaxBetStakeUsd = true
  } else {
    patch.maxBetStakeUsd = draft.maxBetStakeUsd
  }
  return patch
}

export function StakeSettingsDialog({
  open,
  onClose,
  settings,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<StakeDraft>(() =>
    draftFromSettings(settings),
  )

  const saved = draftFromSettings(settings)
  const isPercentStake = draft.mode === 'percent'
  const pendingStake = hasPendingStakeChanges(settings)
  const isRunning = settings.isRunning
  const isDirty = !draftsEqual(draft, saved)
  const canSave = isDirty && isDraftValid(draft) && !busy

  useEffect(() => {
    if (open) {
      setDraft(draftFromSettings(settings))
    }
  }, [open, settings.updatedAt])

  async function handleSave() {
    if (!canSave) return
    setBusy(true)
    try {
      await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify(buildStakePatch(draft)),
      })
      onUpdated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0" showClose={false}>
        <DialogHeader>
          <div className="min-w-0 pr-10">
            <DialogTitle>Stake</DialogTitle>
            <DialogDescription>
              Bet size per trade — percent of balance or fixed USD, with an
              optional cap.
            </DialogDescription>
          </div>
          <DialogClose>Close</DialogClose>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <section>
            <h3 className="text-sm font-medium text-foreground">Sizing mode</h3>
            <div
              className="mt-3 flex w-full max-w-[12rem] rounded-lg border border-border bg-background p-0.5"
              role="group"
              aria-label="Stake sizing mode"
            >
              {(
                [
                  { id: 'percent' as const, label: '% of balance' },
                  { id: 'fixed' as const, label: 'Fixed USD' },
                ] as const
              ).map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => setDraft((d) => ({ ...d, mode: id }))}
                  className={cn(
                    'flex-1 px-2',
                    draft.mode === id
                      ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className={fieldLabelClass}>
                {isPercentStake ? 'Percent' : 'Amount'}
              </p>
              {isPercentStake ? (
                <NumberInput
                  min={0.01}
                  max={100}
                  step={0.5}
                  suffix="%"
                  value={draft.betStakePercent}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) {
                      setDraft((d) => ({ ...d, betStakePercent: n }))
                    }
                  }}
                  disabled={busy}
                  groupClassName="w-full"
                  aria-label="Stake percent of balance"
                />
              ) : (
                <NumberInput
                  min={0.01}
                  step={0.1}
                  prefix="$"
                  value={draft.betStakeUsd}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) {
                      setDraft((d) => ({ ...d, betStakeUsd: n }))
                    }
                  }}
                  disabled={busy}
                  groupClassName="w-full"
                  aria-label="Fixed stake in USD"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {isPercentStake ? '% of balance per bet' : 'Fixed USD per bet'}
              </p>
            </div>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>Cap</p>
              <NumberInput
                min={0.01}
                step={1}
                prefix="$"
                placeholder="No cap"
                value={
                  draft.maxBetStakeUsd != null && draft.maxBetStakeUsd > 0
                    ? draft.maxBetStakeUsd
                    : ''
                }
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    maxBetStakeUsd: parseMaxCap(e.target.value),
                  }))
                }
                disabled={busy}
                groupClassName="w-full"
                className="placeholder:text-muted-foreground/60"
                aria-label="Maximum stake in USD (empty for no cap)"
              />
              <p className="text-xs text-muted-foreground">
                Maximum stake per bet (optional)
              </p>
            </div>
          </section>

          {isRunning && pendingStake ? (
            <p className="text-sm text-warn">
              Changes apply when you restart the engine.
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
