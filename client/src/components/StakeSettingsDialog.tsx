import { useEffect, useMemo, useState } from 'react'
import {
  api,
  normalizeLiveEntryOrderMode,
  type EngineSettings,
  type LimitEntryPreview,
  type LiveEntryOrderMode,
} from '@/api/client'
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
import { DraftNumberInput } from '@/components/ui/draft-number-input'
import {
  hasPendingStakeChanges,
  stakeSnapshotFromSettings,
  type StakeSnapshot,
} from '@/lib/engineStakeSettings'
import {
  limitFeasibilityFromPreview,
  planLimitEntryStake,
} from '@/lib/limitEntryFeasibility'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  settings: EngineSettings
  onUpdated: () => void
  tradingMode: string
  balanceUsd: number | null
  paperAccountId?: number | null
}

type StakeDraft = StakeSnapshot & {
  liveEntryOrderMode: LiveEntryOrderMode
}

const fieldLabelClass =
  'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'

const ENTRY_ORDER_OPTIONS: {
  value: LiveEntryOrderMode
  label: string
  hint: string
}[] = [
  {
    value: 'Limit',
    label: 'Limit',
    hint: 'Post-only @ bid · 0% fee · min 5 shares',
  },
  {
    value: 'Market',
    label: 'Market',
    hint: 'IOC taker · small $ OK · ~3.5% fee',
  },
]

function draftFromSettings(settings: EngineSettings): StakeDraft {
  return {
    ...stakeSnapshotFromSettings(settings, 'pending'),
    liveEntryOrderMode: normalizeLiveEntryOrderMode(settings.liveEntryOrderMode),
  }
}

function draftsEqual(a: StakeDraft, b: StakeDraft): boolean {
  return (
    a.mode === b.mode &&
    a.betStakePercent === b.betStakePercent &&
    a.betStakeUsd === b.betStakeUsd &&
    a.maxBetStakeUsd === b.maxBetStakeUsd &&
    a.liveEntryOrderMode === b.liveEntryOrderMode
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
    liveEntryOrderMode: draft.liveEntryOrderMode,
  }
  if (draft.maxBetStakeUsd == null) {
    patch.clearMaxBetStakeUsd = true
  } else {
    patch.maxBetStakeUsd = draft.maxBetStakeUsd
  }
  return patch
}

function buildPreviewQuery(
  draft: StakeDraft,
  tradingMode: string,
  paperAccountId?: number | null,
): string {
  const params = new URLSearchParams()
  params.set('tradingMode', tradingMode)
  if (paperAccountId != null) {
    params.set('paperAccountId', String(paperAccountId))
  }
  params.set('betStakeMode', draft.mode)
  params.set('betStakePercent', String(draft.betStakePercent))
  params.set('betStakeUsd', String(draft.betStakeUsd))
  if (draft.maxBetStakeUsd == null || draft.maxBetStakeUsd <= 0) {
    params.set('clearMaxBetStakeUsd', 'true')
  } else {
    params.set('maxBetStakeUsd', String(draft.maxBetStakeUsd))
  }
  return params.toString()
}

export function StakeSettingsDialog({
  open,
  onClose,
  settings,
  onUpdated,
  tradingMode,
  balanceUsd,
  paperAccountId,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<StakeDraft>(() =>
    draftFromSettings(settings),
  )
  const [limitPreview, setLimitPreview] = useState<LimitEntryPreview | null>(
    null,
  )
  const [limitPreviewLoading, setLimitPreviewLoading] = useState(false)
  const [limitPreviewError, setLimitPreviewError] = useState<string | null>(
    null,
  )

  const saved = draftFromSettings(settings)
  const isPercentStake = draft.mode === 'percent'
  const pendingStake = hasPendingStakeChanges(settings)
  const isRunning = settings.isRunning
  const isDirty = !draftsEqual(draft, saved)
  const canSave = isDirty && isDraftValid(draft) && !busy
  const isLimitMode = draft.liveEntryOrderMode === 'Limit'

  useEffect(() => {
    if (open) {
      setDraft(draftFromSettings(settings))
    }
  }, [open, settings.updatedAt])

  useEffect(() => {
    if (!open || !isLimitMode) {
      setLimitPreview(null)
      setLimitPreviewError(null)
      return
    }

    let cancelled = false
    const query = buildPreviewQuery(draft, tradingMode, paperAccountId)
    setLimitPreviewLoading(true)
    setLimitPreviewError(null)

    void api<LimitEntryPreview>(`/api/engine/limit-entry-preview?${query}`)
      .then((preview) => {
        if (!cancelled) setLimitPreview(preview)
      })
      .catch((e) => {
        if (!cancelled) {
          setLimitPreview(null)
          setLimitPreviewError(
            e instanceof Error ? e.message : 'Could not load limit preview',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLimitPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, isLimitMode, draft, tradingMode, paperAccountId])

  const localLimitPlan = useMemo(() => {
    if (
      !isLimitMode ||
      balanceUsd == null ||
      limitPreview?.referenceBid == null
    ) {
      return null
    }
    return planLimitEntryStake(balanceUsd, draft, limitPreview.referenceBid)
  }, [isLimitMode, balanceUsd, draft, limitPreview?.referenceBid])

  const limitFeasibility = limitFeasibilityFromPreview(
    limitPreview,
    limitPreviewLoading,
    limitPreviewError,
  )

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
            <DialogTitle>Stake &amp; entry</DialogTitle>
            <DialogDescription>
              Bet sizing and order type (paper uses the same limit rules).
            </DialogDescription>
          </div>
          <DialogClose>Close</DialogClose>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <section>
            <p className={fieldLabelClass}>Entry order</p>
            <div
              className="mt-2 flex w-full rounded-lg border border-border bg-background p-0.5"
              role="group"
              aria-label="Entry order type"
            >
              {ENTRY_ORDER_OPTIONS.map(({ value, label, hint }) => (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  title={hint}
                  onClick={() =>
                    setDraft((d) => ({ ...d, liveEntryOrderMode: value }))
                  }
                  className={cn(
                    'h-auto min-h-8 flex-1 flex-col gap-0 py-1.5',
                    draft.liveEntryOrderMode === value
                      ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  <span className="text-xs font-medium">{label}</span>
                </Button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {
                ENTRY_ORDER_OPTIONS.find(
                  (o) => o.value === draft.liveEntryOrderMode,
                )?.hint
              }
            </p>

            {isLimitMode ? (
              <div
                className={cn(
                  'mt-3 rounded-lg border px-3 py-2.5 text-xs leading-relaxed',
                  limitFeasibility.tone === 'ok' &&
                    'border-emerald-500/30 bg-emerald-500/5 text-foreground',
                  limitFeasibility.tone === 'warn' &&
                    'border-warn/40 bg-warn/5 text-foreground',
                  limitFeasibility.tone === 'error' &&
                    'border-destructive/40 bg-destructive/5 text-foreground',
                  limitFeasibility.tone === 'muted' &&
                    'border-border bg-muted/30 text-muted-foreground',
                )}
                role="status"
              >
                {limitFeasibility.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {localLimitPlan &&
                limitPreview?.referenceBid != null &&
                !limitPreviewLoading ? (
                  <p className="mt-1.5 text-muted-foreground">
                    Draft:{' '}
                    {localLimitPlan.canTrade
                      ? `~$${localLimitPlan.effectiveStakeUsd.toFixed(2)} per entry`
                      : localLimitPlan.blockReason}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Market entries can be small ($1+); taker fees apply on live.
              </p>
            )}
          </section>

          <section>
            <p className={fieldLabelClass}>Sizing</p>
            <div
              className="mt-2 flex w-full max-w-[12rem] rounded-lg border border-border bg-background p-0.5"
              role="group"
              aria-label="Stake sizing mode"
            >
              {(
                [
                  { id: 'percent' as const, label: '%' },
                  { id: 'fixed' as const, label: 'USD' },
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

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className={fieldLabelClass}>
                  {isPercentStake ? 'Percent' : 'Amount'}
                </p>
                {isPercentStake ? (
                  <DraftNumberInput
                    key="percent"
                    suffix="%"
                    value={draft.betStakePercent}
                    onCommit={(next) => {
                      if (next == null) return
                      setDraft((d) => ({ ...d, betStakePercent: next }))
                    }}
                    disabled={busy}
                    groupClassName="w-full"
                    aria-label="Stake percent of balance"
                  />
                ) : (
                  <DraftNumberInput
                    key="fixed"
                    prefix="$"
                    value={draft.betStakeUsd}
                    onCommit={(next) => {
                      if (next == null) return
                      setDraft((d) => ({ ...d, betStakeUsd: next }))
                    }}
                    disabled={busy}
                    groupClassName="w-full"
                    aria-label="Fixed stake in USD"
                  />
                )}
              </div>

              <div className="space-y-1">
                <p className={fieldLabelClass}>Cap</p>
                <DraftNumberInput
                  prefix="$"
                  placeholder="No cap"
                  allowEmpty
                  value={
                    draft.maxBetStakeUsd != null && draft.maxBetStakeUsd > 0
                      ? draft.maxBetStakeUsd
                      : null
                  }
                  onCommit={(next) =>
                    setDraft((d) => ({
                      ...d,
                      maxBetStakeUsd:
                        next == null || next <= 0 ? null : next,
                    }))
                  }
                  disabled={busy}
                  groupClassName="w-full"
                  className="placeholder:text-muted-foreground/60"
                  aria-label="Maximum stake in USD"
                />
              </div>
            </div>
            {balanceUsd != null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Balance for preview: ${balanceUsd.toFixed(2)} (
                {tradingMode === 'Paper' ? 'paper' : 'live'}).
              </p>
            ) : null}
          </section>

          {isRunning && pendingStake ? (
            <p className="text-sm text-warn">
              Stake changes apply when you restart the engine. Entry order type
              applies on the next entry.
            </p>
          ) : isRunning ? (
            <p className="text-xs text-muted-foreground">
              Entry order type applies on the next entry.
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
