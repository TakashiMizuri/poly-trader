import { useState } from 'react'
import { Settings } from 'lucide-react'
import type { BalanceResponse, EngineSettings } from '@/api/client'
import { AccountMetric, AccountMetricsBar, Skeleton } from '@/components/app-ui'
import { PaperTradingSettingsDialog } from '@/components/PaperTradingSettingsDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  settings: EngineSettings | null
  balance: BalanceResponse | null
  tradingMode: string | undefined
  onUpdated: () => void
  className?: string
}

export function DashboardBalancePanel({
  settings,
  balance,
  tradingMode,
  onUpdated,
  className,
}: Props) {
  const [paperSettingsOpen, setPaperSettingsOpen] = useState(false)
  const isPaper = tradingMode === 'Paper'
  const displayBalance =
    balance?.paperBalance ?? settings?.activePaperBalance ?? null

  const paperLabel =
    isPaper && balance?.paperAccountName
      ? `Paper · ${balance.paperAccountName}`
      : 'Paper'

  const pending = settings == null && balance == null

  if (pending) {
    return (
      <AccountMetricsBar className={cn('min-h-[5.5rem] shrink-0', className)}>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-4 py-3 sm:min-w-[7.5rem]"
          >
            <Skeleton shimmer={false} className="h-3 w-16 rounded" />
            <Skeleton shimmer={false} className="h-7 w-24 rounded-lg" />
            <Skeleton shimmer={false} className="h-3 w-28 rounded" />
          </div>
        ))}
      </AccountMetricsBar>
    )
  }

  return (
    <AccountMetricsBar className={cn('min-h-[5.5rem] shrink-0', className)}>
      <AccountMetric
        label={paperLabel}
        value={
          displayBalance != null ? `$${displayBalance.toFixed(2)}` : '—'
        }
        hint={isPaper ? 'Simulated · live prices' : undefined}
        badge={
          isPaper && settings ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setPaperSettingsOpen(true)}
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Paper trading settings"
              title="Paper trading settings"
            >
              <Settings className="size-3.5" aria-hidden />
            </Button>
          ) : undefined
        }
      />
      {isPaper && settings ? (
        <PaperTradingSettingsDialog
          open={paperSettingsOpen}
          onClose={() => setPaperSettingsOpen(false)}
          settings={settings}
          balance={balance}
          onUpdated={onUpdated}
        />
      ) : null}
      <AccountMetric
        label="Live USDC"
        value={
          balance?.liveBalance != null
            ? `$${balance.liveBalance.toFixed(2)}`
            : '—'
        }
        hint={
          balance?.liveBalance != null
            ? 'USDC · your CLOB wallet'
            : 'Key not set on API'
        }
      />
    </AccountMetricsBar>
  )
}
