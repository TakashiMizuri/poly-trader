import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
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
import { LiveChart, type LiveChartHandle } from '@/components/LiveChart'
import { PositionsPanel } from '@/components/PositionsPanel'
import { Button } from '@/components/ui/button'
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

  const chartRange = useMemo(
    () => ({
      candleRangeMode: chartDisplayPrefs.candleRangeMode,
      candleRangeFromMs: chartDisplayPrefs.candleRangeFromMs,
      maxCandles: chartDisplayPrefs.maxCandles,
    }),
    [
      chartDisplayPrefs.candleRangeMode,
      chartDisplayPrefs.candleRangeFromMs,
      chartDisplayPrefs.maxCandles,
    ],
  )

  const { candles, status: candleStatus } = useBinanceLiveCandles({
    symbol: 'BTCUSDT',
    interval: '5m',
    liveRefreshMs: 1000,
    chartRange,
  })

  const chartLoading =
    candles.length === 0 && candleStatus !== 'error'

  const btcChartRef = useRef<LiveChartHandle>(null)

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
  useTradingLiveEvent('EntryFailed', bumpTrades)
  useTradingLiveEvent('PositionsFeedChanged', bumpTrades)
  useTradingLiveEvent('CandleClosed', bumpTrades)

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3 p-3 lg:h-full lg:min-h-0 md:gap-4 md:p-4">
      <header className="grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2 sm:gap-3">
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
          className="min-w-0 w-max max-w-[42vw] shrink-0 sm:max-w-none"
        />
      </header>

      <div className="grid min-w-0 max-w-full gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(440px,600px)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(480px,680px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(520px,720px)]">
        <PageCard
          title="BTC / USDT"
          fill
          className="min-w-0 max-w-full min-h-[min(52vw,280px)] sm:min-h-[min(44vh,360px)] lg:min-h-0"
          contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          action={
            <div className="flex items-center gap-1.5">
              <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
                5m · Binance
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => btcChartRef.current?.openSettings()}
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Chart settings"
                title="Chart settings"
              >
                <Settings className="size-3.5" aria-hidden />
              </Button>
            </div>
          }
        >
          <LiveChart
            ref={btcChartRef}
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
