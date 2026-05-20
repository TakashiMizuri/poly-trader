import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card } from '@/components/ui/card'
import { formatDisplayDateTime } from '@/lib/displayLocale'
import { useTimeFormat } from '@/context/TimeFormatContext'
import { cn } from '@/lib/utils'

interface TradeRow {
  id: number
  candleTime: number
  side: string
  trend: string
  mode: string
  stakeUsd: number
  entryPrice: number
  entryShares?: number
  won?: boolean | null
  pnlUsd?: number | null
  paperAccountId?: number
  createdAt: string
}

interface Props {
  refreshKey?: number
  paperAccountId?: number | null
  tradingMode?: string
  className?: string
}

export function TradeHistoryTable({
  refreshKey = 0,
  paperAccountId,
  tradingMode,
  className,
}: Props) {
  const { timeFormat } = useTimeFormat()
  const [trades, setTrades] = useState<TradeRow[]>([])

  useEffect(() => {
    const params = new URLSearchParams({ limit: '200' })
    if (tradingMode) params.set('mode', tradingMode)
    if (tradingMode === 'Paper' && paperAccountId != null) {
      params.set('paperAccountId', String(paperAccountId))
    }
    api<TradeRow[]>(`/api/trades?${params}`).then(setTrades).catch(console.error)
  }, [refreshKey, paperAccountId, tradingMode])

  if (trades.length === 0) {
    return (
      <p className={cn('py-6 text-center text-sm text-muted-foreground', className)}>
        No trades yet
      </p>
    )
  }

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {trades.map((t) => (
        <Card key={t.id} className="p-3">
          <p className="text-xs text-muted-foreground">
            {formatDisplayDateTime(t.candleTime * 1000, timeFormat)}
          </p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <TradeField label="Side" value={t.side} />
            <TradeField label="Trend" value={t.trend} />
            <TradeField label="Price" value={t.entryPrice.toFixed(4)} />
            <TradeField
              label="Shares"
              value={
                t.entryShares != null
                  ? t.entryShares.toFixed(2)
                  : (t.stakeUsd / t.entryPrice).toFixed(2)
              }
            />
            <TradeField label="Stake" value={`$${t.stakeUsd.toFixed(2)}`} />
            <TradeField
              label="Won"
              value={t.won == null ? '—' : t.won ? 'Yes' : 'No'}
            />
            <TradeField
              label="PnL"
              value={t.pnlUsd != null ? `$${t.pnlUsd.toFixed(2)}` : '—'}
              valueClassName={
                t.pnlUsd != null
                  ? t.pnlUsd >= 0
                    ? 'text-primary'
                    : 'text-destructive'
                  : undefined
              }
            />
          </dl>
        </Card>
      ))}
    </ul>
  )
}

function TradeField({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('font-medium text-foreground', valueClassName)}>{value}</dd>
    </div>
  )
}
