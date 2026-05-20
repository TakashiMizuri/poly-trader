import type { MarketWindow } from '@/api/client'
import { Panel } from '@/components/app-ui'
export function MarketProgressBar({ market }: { market: MarketWindow | null }) {
  if (!market?.active) {
    return (
      <Panel className="rounded-lg px-4 py-3 text-sm text-muted-foreground">
        No active Polymarket BTC 5m window
      </Panel>
    )
  }

  const pct = market.progressPercent ?? 0

  return (
    <Panel className="rounded-lg px-4 py-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{market.title ?? 'BTC 5m'}</span>
        <span className="text-primary">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </Panel>
  )
}
