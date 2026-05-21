import { useState, type ReactNode } from 'react'
import { Settings, Wallet } from 'lucide-react'
import type { BalanceResponse, EngineSettings } from '@/api/client'
import { AccountMetric, AccountMetricsBar, Skeleton } from '@/components/app-ui'
import { PaperTradingSettingsDialog } from '@/components/PaperTradingSettingsDialog'
import { StakeSettingsDialog } from '@/components/StakeSettingsDialog'
import { Button } from '@/components/ui/button'
import { usePaperTrading } from '@/context/PaperTradingContext'
import {
  formatStakeSnapshotInline,
  hasPendingStakeChanges,
  stakeSnapshotFromSettings,
} from '@/lib/engineStakeSettings'
import { cn } from '@/lib/utils'

function stakeMetricHint(settings: EngineSettings): string {
  const line = formatStakeSnapshotInline(
    stakeSnapshotFromSettings(settings, 'active'),
  )
  return hasPendingStakeChanges(settings) ? `${line} · pending` : line
}

function MetricSettingsBadge({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>
}

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
  const { paperTradingEnabled } = usePaperTrading()
  const [paperSettingsOpen, setPaperSettingsOpen] = useState(false)
  const [stakeSettingsOpen, setStakeSettingsOpen] = useState(false)
  const isPaper = paperTradingEnabled && tradingMode === 'Paper'
  const stakeOnPaperMetric = paperTradingEnabled && isPaper
  const stakeOnLiveMetric = !stakeOnPaperMetric
  const displayBalance =
    balance?.paperBalance ?? settings?.activePaperBalance ?? null

  const paperLabel =
    isPaper && balance?.paperAccountName
      ? `Paper · ${balance.paperAccountName}`
      : 'Paper'

  const pending = settings == null && balance == null

  if (pending) {
    const skeletonCount = paperTradingEnabled ? 2 : 1
    return (
      <AccountMetricsBar className={cn('min-h-[5.5rem] shrink-0', className)}>
        {Array.from({ length: skeletonCount }, (_, i) => (
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
      {paperTradingEnabled ? (
        <>
          <AccountMetric
            label={paperLabel}
            value={
              displayBalance != null ? `$${displayBalance.toFixed(2)}` : '—'
            }
            hint={
              stakeOnPaperMetric && settings
                ? stakeMetricHint(settings)
                : isPaper
                  ? 'Simulated · live prices'
                  : undefined
            }
            badge={
              settings ? (
                <MetricSettingsBadge>
                  {isPaper ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPaperSettingsOpen(true)}
                      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label="Paper trading settings"
                      title="Paper trading settings"
                    >
                      <Wallet className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                  {stakeOnPaperMetric ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setStakeSettingsOpen(true)}
                      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label="Stake settings"
                      title="Stake settings"
                    >
                      <Settings className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </MetricSettingsBadge>
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
        </>
      ) : null}
      <AccountMetric
        label="Live USDC"
        value={
          balance?.liveBalance != null
            ? `$${balance.liveBalance.toFixed(2)}`
            : '—'
        }
        hint={
          settings && stakeOnLiveMetric
            ? stakeMetricHint(settings)
            : balance?.liveBalance != null
              ? 'USDC · your CLOB wallet'
              : balance?.clobConfigured === false
                ? 'Set POLYMARKET_PRIVATE_KEY on API'
                : 'Balance unavailable — check API logs'
        }
        badge={
          settings && stakeOnLiveMetric ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setStakeSettingsOpen(true)}
              className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Stake settings"
              title="Stake settings"
            >
              <Settings className="size-3.5" aria-hidden />
            </Button>
          ) : undefined
        }
      />
      {settings ? (
        <StakeSettingsDialog
          open={stakeSettingsOpen}
          onClose={() => setStakeSettingsOpen(false)}
          settings={settings}
          onUpdated={onUpdated}
        />
      ) : null}
    </AccountMetricsBar>
  )
}
