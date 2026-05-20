import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type BalanceResponse,
  type EngineSettings,
} from '@/api/client'
import { usePoll } from '@/api/hooks'
import { useTradingLiveEvent } from '@/api/tradingLive'
import { PageCard } from '@/components/app-ui'
import { DashboardBalancePanel } from '@/components/DashboardBalancePanel'
import { DashboardEnginePanel } from '@/components/DashboardEnginePanel'
import { LiveChart } from '@/components/LiveChart'
import { PositionsPanel } from '@/components/PositionsPanel'
import { useBinanceLiveCandles } from '@/hooks/useBinanceLiveCandles'
import { clearPollCache } from '@/api/poll-cache'
import { GLOBAL_RESET_EVENT } from '@/lib/appReset'

type AccountSnapshot = {
  settings: EngineSettings
  balance: BalanceResponse
}

type ChartMarker = { time: number; side: string; won?: boolean | null }

async function fetchAccount(): Promise<AccountSnapshot> {
  const [settings, balance] = await Promise.all([
    api<EngineSettings>('/api/engine'),
    api<BalanceResponse>('/api/balance'),
  ])
  return { settings, balance }
}

export function DashboardPage() {
  const [tradeRefreshKey, setTradeRefreshKey] = useState(0)

  const accountPoll = usePoll(useCallback(() => fetchAccount(), []), false, {
    cacheKey: 'api/account',
  })

  const settings = accountPoll.data?.settings ?? null
  const balance = accountPoll.data?.balance ?? null

  const paperAccountId =
    balance?.paperAccountId ?? settings?.activePaperAccountId
  const tradingMode = balance?.mode ?? settings?.tradingMode

  const markersCacheKey = useMemo(
    () => `api/trades/chart-markers:${paperAccountId ?? 'all'}`,
    [paperAccountId],
  )

  const fetchMarkers = useCallback(async (): Promise<ChartMarker[]> => {
    const path =
      paperAccountId != null
        ? `/api/trades/chart-markers?paperAccountId=${paperAccountId}`
        : '/api/trades/chart-markers'
    return api<ChartMarker[]>(path)
  }, [paperAccountId])

  const markersPoll = usePoll(fetchMarkers, false, {
    cacheKey: markersCacheKey,
  })
  const markers = markersPoll.data ?? []

  const refreshAccount = accountPoll.refresh
  const loadMarkers = markersPoll.refresh

  const { candles, status: candleStatus } = useBinanceLiveCandles({
    symbol: 'BTCUSDT',
    interval: '5m',
    liveRefreshMs: 1000,
  })

  const chartLoading =
    candles.length === 0 && candleStatus !== 'error'

  const feedCacheKey = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' })
    if (tradingMode) params.set('mode', tradingMode)
    if (tradingMode === 'Paper' && paperAccountId != null) {
      params.set('paperAccountId', String(paperAccountId))
    }
    return `api/trades/feed:${params.toString()}`
  }, [paperAccountId, tradingMode])

  useEffect(() => {
    const onGlobalReset = () => {
      clearPollCache(feedCacheKey)
      void refreshAccount()
      void loadMarkers()
      setTradeRefreshKey((k) => k + 1)
    }
    window.addEventListener(GLOBAL_RESET_EVENT, onGlobalReset)
    return () => window.removeEventListener(GLOBAL_RESET_EVENT, onGlobalReset)
  }, [feedCacheKey, refreshAccount, loadMarkers])

  const bumpTrades = useCallback(() => {
    clearPollCache(feedCacheKey)
    setTradeRefreshKey((k) => k + 1)
  }, [feedCacheKey])

  useTradingLiveEvent('BalanceUpdated', () => void refreshAccount())
  useTradingLiveEvent('EngineStatus', () => {
    void refreshAccount()
    bumpTrades()
  })
  useTradingLiveEvent('MarketWindowUpdated', bumpTrades)
  useTradingLiveEvent('TradePlaced', () => {
    void loadMarkers()
    bumpTrades()
    void refreshAccount()
  })
  useTradingLiveEvent('CandleClosed', bumpTrades)

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3 md:gap-4 md:p-4">
      <div className="flex min-h-[7.25rem] shrink-0 flex-col gap-3 sm:flex-row sm:items-stretch">
        <DashboardBalancePanel
          settings={settings}
          balance={balance}
          tradingMode={tradingMode}
          onUpdated={refreshAccount}
        />
        <DashboardEnginePanel
          settings={settings}
          onUpdated={refreshAccount}
        />
      </div>

      <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <PageCard
          title="BTC / USDT"
          fill
          className="min-h-[min(52vh,480px)] lg:min-h-0"
          contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          action={
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              5m · Binance
            </span>
          }
        >
          <LiveChart
            candles={candles}
            timeframe="5m"
            engineMarkers={markers}
            loading={chartLoading}
            className="min-h-0 flex-1"
          />
        </PageCard>

        <PositionsPanel
          refreshKey={tradeRefreshKey}
          paperAccountId={paperAccountId}
          tradingMode={tradingMode}
          className="min-h-[min(40vh,360px)] lg:min-h-0"
        />
      </section>
    </div>
  )
}
