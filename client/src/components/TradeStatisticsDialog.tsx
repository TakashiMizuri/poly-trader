import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  api,
  type TradeStatistics,
  type TradeStatisticsPeriod,
} from '@/api/client'
import { Stat } from '@/components/app-ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { skipLabel } from '@/lib/positionDisplay'
import { cn } from '@/lib/utils'

const PERIOD_OPTIONS: { value: TradeStatisticsPeriod; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'day', label: 'Last 24 hours' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

interface Props {
  open: boolean
  onClose: () => void
  tradingMode?: string
  paperAccountId?: number | null
}

function buildStatsParams(
  period: TradeStatisticsPeriod,
  paperAccountId?: number | null,
  tradingMode?: string,
): URLSearchParams {
  const params = new URLSearchParams({ period })
  if (tradingMode) params.set('mode', tradingMode)
  if (tradingMode === 'Paper' && paperAccountId != null) {
    params.set('paperAccountId', String(paperAccountId))
  }
  return params
}

function formatWinRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function formatPnlUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value).toFixed(2)
  if (value >= 0) return `+$${abs}`
  return `-$${abs}`
}

function formatPayoutRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2)}×`
}

function formatShare(count: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((count / total) * 100)}%`
}

function BreakdownRow({
  label,
  count,
  total,
  tone,
}: {
  label: string
  count: number
  total: number
  tone?: 'success' | 'danger' | 'warn'
}) {
  if (count <= 0) return null

  const toneClass =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'danger'
        ? 'text-red-600 dark:text-red-400'
        : tone === 'warn'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-foreground'

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {count} of {total} · {formatShare(count, total)}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 font-mono text-sm font-semibold tabular-nums',
          toneClass,
        )}
      >
        {count}
      </span>
    </div>
  )
}

function BreakdownList({ stats }: { stats: TradeStatistics }) {
  const { totalEvents } = stats
  const rows: ReactNode[] = []

  if (stats.tradesOpened > 0) {
    rows.push(
      <BreakdownRow
        key="opened"
        label="Opened positions"
        count={stats.tradesOpened}
        total={totalEvents}
      />,
    )
  }

  if (stats.won > 0) {
    rows.push(
      <BreakdownRow
        key="won"
        label="Won"
        count={stats.won}
        total={stats.tradesSettled > 0 ? stats.tradesSettled : totalEvents}
        tone="success"
      />,
    )
  }

  if (stats.lost > 0) {
    rows.push(
      <BreakdownRow
        key="lost"
        label="Lost"
        count={stats.lost}
        total={stats.tradesSettled > 0 ? stats.tradesSettled : totalEvents}
        tone="danger"
      />,
    )
  }

  if (stats.tradesOpen > 0) {
    rows.push(
      <BreakdownRow
        key="open"
        label="Still open"
        count={stats.tradesOpen}
        total={totalEvents}
        tone="warn"
      />,
    )
  }

  for (const item of stats.skipBreakdown) {
    const label = skipLabel(item.reason) ?? item.reason.replaceAll('_', ' ')
    rows.push(
      <BreakdownRow
        key={item.reason}
        label={label}
        count={item.count}
        total={totalEvents}
      />,
    )
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No trading activity in this period
      </p>
    )
  }

  return <div className="space-y-1.5">{rows}</div>
}

export function TradeStatisticsDialog({
  open,
  onClose,
  tradingMode,
  paperAccountId,
}: Props) {
  const [period, setPeriod] = useState<TradeStatisticsPeriod>('all')
  const [stats, setStats] = useState<TradeStatistics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const statsParams = useMemo(
    () => buildStatsParams(period, paperAccountId, tradingMode),
    [period, paperAccountId, tradingMode],
  )

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<TradeStatistics>(
        `/api/trades/statistics?${statsParams}`,
      )
      setStats(data)
    } catch (e) {
      console.error(e)
      setStats(null)
      setError(e instanceof Error ? e.message : 'Failed to load statistics')
    } finally {
      setLoading(false)
    }
  }, [statsParams])

  useEffect(() => {
    if (!open) return
    void loadStats()
  }, [open, loadStats])

  const periodLabel =
    PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Trading statistics</DialogTitle>
          <DialogDescription>
            Win rate and outcome breakdown for the selected period
            {tradingMode ? ` (${tradingMode})` : ''}.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Period
            </label>
            <Select
              value={period}
              onValueChange={(v) => setPeriod(v as TradeStatisticsPeriod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading && !stats ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : error ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadStats()}
              >
                Retry
              </Button>
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Win rate"
                  value={formatWinRate(stats.winRate)}
                  hint={
                    stats.tradesSettled > 0
                      ? `${stats.won}W / ${stats.lost}L settled`
                      : 'No settled trades'
                  }
                />
                <Stat
                  label="Avg win ratio"
                  value={formatPayoutRatio(stats.avgWinPayoutRatio)}
                  hint={
                    stats.won > 0
                      ? `|PnL|/stake · ${stats.won} wins`
                      : 'No winning trades'
                  }
                />
                <Stat
                  label="Total events"
                  value={stats.totalEvents}
                  hint={periodLabel}
                />
                <Stat
                  label="Net PnL"
                  value={formatPnlUsd(stats.totalPnlUsd)}
                  hint={
                    stats.tradesSettled > 0
                      ? `${stats.tradesSettled} settled`
                      : undefined
                  }
                />
              </div>

              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Breakdown
                </h3>
                <BreakdownList stats={stats} />
              </div>
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
