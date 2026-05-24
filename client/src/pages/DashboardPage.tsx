import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type BalanceResponse,
  type EngineSettings,
} from '@/api/client'
import { usePoll } from '@/api/hooks'
import { useTradingLiveEvent } from '@/api/tradingLive'
import { PageCard } from '@/components/app-ui'
import { DashboardBalanceChart } from '@/components/DashboardBalanceChart'
import { DashboardBalancePanel } from '@/components/DashboardBalancePanel'
import { DashboardEnginePanel } from '@/components/DashboardEnginePanel'
import { LiveChart } from '@/components/LiveChart'
import { PositionsPanel } from '@/components/PositionsPanel'
import { useBinanceLiveCandles } from '@/hooks/useBinanceLiveCandles'
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs'
import { clearPollCache, writePollCache } from '@/api/poll-cache'
import { usePaperTrading } from '@/context/PaperTradingContext'
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
  const { paperTradingEnabled } = usePaperTrading()
  const [tradeRefreshKey, setTradeRefreshKey] = useState(0)

  const accountPoll = usePoll(useCallback(() => fetchAccount(), []), 25_000, {
    cacheKey: 'api/account',
  })

  const settings = accountPoll.data?.settings ?? null
  const balance = accountPoll.data?.balance ?? null

  const paperAccountId = paperTradingEnabled
    ? (balance?.paperAccountId ?? settings?.activePaperAccountId)
    : null
  const tradingMode = paperTradingEnabled
    ? (balance?.mode ?? settings?.tradingMode)
    : 'Live'

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

  const refreshAccount = useCallback(async () => {
    clearPollCache('api/account')
    await accountPoll.refresh()
  }, [accountPoll.refresh])

  const applyAccountSettings = useCallback(
    (settings: EngineSettings) => {
      clearPollCache('api/account')
      accountPoll.patchData((prev) => {
        if (prev == null) return prev
        const next = { ...prev, settings }
        writePollCache('api/account', next)
        return next
      })
    },
    [accountPoll.patchData],
  )

  const loadMarkers = markersPoll.refresh

  useEffect(() => {
    if (paperTradingEnabled || settings?.tradingMode !== 'Paper') return
    let cancelled = false
    void api<EngineSettings>('/api/engine', {
      method: 'PUT',
      body: JSON.stringify({ tradingMode: 'Live', isRunning: false }),
    }).then(() => {
      if (!cancelled) void refreshAccount()
    })
    return () => {
      cancelled = true
    }
  }, [paperTradingEnabled, settings?.tradingMode, settings?.updatedAt, refreshAccount])

  const [chartDisplayPrefs] = useChartDisplayPrefs()

  const { candles, status: candleStatus } = useBinanceLiveCandles({
    symbol: 'BTCUSDT',
    interval: '5m',
    liveRefreshMs: 1000,
    historyLimit: chartDisplayPrefs.maxCandles,
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
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3 p-3 lg:h-full lg:min-h-0 md:gap-4 md:p-4">
      <header className="grid min-w-0 shrink-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
        <DashboardBalancePanel
          settings={settings}
          balance={balance}
          tradingMode={tradingMode}
          onUpdated={refreshAccount}
          className="min-w-0"
        />
        <DashboardEnginePanel
          settings={settings}
          onSettingsSaved={applyAccountSettings}
          onUpdated={refreshAccount}
          className="min-w-0 w-full lg:w-max lg:max-w-full"
        />
      </header>

      <div className="grid min-w-0 max-w-full gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(440px,600px)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(480px,680px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(520px,720px)]">
        <PageCard
          title="BTC / USDT"
          fill
          className="min-w-0 max-w-full min-h-[min(52vw,280px)] sm:min-h-[min(44vh,360px)] lg:min-h-0"
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

        <aside className="flex min-h-0 min-w-0 max-w-full flex-col gap-3 lg:min-h-0">
          <DashboardBalanceChart
            paperAccountId={paperAccountId}
            tradingMode={tradingMode}
            liveBalance={balance?.liveBalance}
            clobConfigured={balance?.clobConfigured}
            className="h-[min(32vw,200px)] shrink-0 sm:h-[min(28vh,240px)] lg:h-[220px]"
          />
          <PositionsPanel
            refreshKey={tradeRefreshKey}
            paperAccountId={paperAccountId}
            tradingMode={tradingMode}
            engineRunning={settings?.isRunning ?? false}
            className="min-h-[min(48vh,420px)] lg:min-h-0 lg:flex-1"
          />
        </aside>
      </div>
    </div>
  )
}
