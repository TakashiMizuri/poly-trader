import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

interface TradeRow {
  id: number
  candleTime: number
  side: string
  trend: string
  mode: string
  stakeUsd: number
  entryPrice: number
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
      <p className={cn('py-6 text-center text-sm text-[#9ca3af]', className)}>
        No trades yet
      </p>
    )
  }

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {trades.map((t) => (
        <li
          key={t.id}
          className="rounded-lg border border-[#1e2633] bg-[#0c0f14] p-3"
        >
          <p className="text-xs text-[#9ca3af]">
            {new Date(t.candleTime * 1000).toLocaleString()}
          </p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <TradeField label="Side" value={t.side} />
            <TradeField label="Trend" value={t.trend} />
            <TradeField label="Entry" value={t.entryPrice.toFixed(4)} />
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
                    ? 'text-[#3dd6c6]'
                    : 'text-[#ef4444]'
                  : undefined
              }
            />
          </dl>
        </li>
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
      <dt className="text-[#9ca3af]">{label}</dt>
      <dd className={cn('font-medium text-[#e8eaed]', valueClassName)}>{value}</dd>
    </div>
  )
}
