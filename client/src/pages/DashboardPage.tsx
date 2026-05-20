import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type BalanceResponse,
  type ConnectivityStatus,
  type EngineSettings,
  type MarketWindow,
} from '@/api/client'
import { createTradingConnection } from '@/api/signalR'
import { EngineControls } from '@/components/EngineControls'
import { LiveChart } from '@/components/LiveChart'
import { MarketProgressBar } from '@/components/MarketProgressBar'
import { TradeHistoryTable } from '@/components/TradeHistoryTable'
import { useBinanceLiveCandles } from '@/hooks/useBinanceLiveCandles'

export function DashboardPage() {
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [balance, setBalance] = useState<BalanceResponse | null>(null)
  const [history, setHistory] = useState<Array<{ time: number; value: number }>>([])
  const [connectivity, setConnectivity] = useState<ConnectivityStatus | null>(null)
  const [tradeRefreshKey, setTradeRefreshKey] = useState(0)

  const { candles } = useBinanceLiveCandles({
    symbol: 'BTCUSDT',
    interval: '5m',
    liveRefreshMs: 1000,
  })
  const [market, setMarket] = useState<MarketWindow | null>(null)
  const [markers, setMarkers] = useState<
    Array<{ time: number; side: string; won?: boolean | null }>
  >([])

  const paperAccountId = balance?.paperAccountId ?? settings?.activePaperAccountId

  const refreshAccount = useCallback(async () => {
    const [s, b, c] = await Promise.all([
      api<EngineSettings>('/api/engine'),
      api<BalanceResponse>('/api/balance'),
      api<ConnectivityStatus>('/api/health/connectivity'),
    ])
    setSettings(s)
    setBalance(b)
    setConnectivity(c)

    const accountId = b.paperAccountId ?? s.activePaperAccountId
    const historyPath =
      accountId != null
        ? `/api/balance/history?paperAccountId=${accountId}`
        : '/api/balance/history'
    setHistory(await api<Array<{ time: number; value: number }>>(historyPath))
  }, [])

  const loadMarket = useCallback(async () => {
    setMarket(await api<MarketWindow>('/api/market/active'))
  }, [])

  const loadMarkers = useCallback(async () => {
    const path =
      paperAccountId != null
        ? `/api/trades/chart-markers?paperAccountId=${paperAccountId}`
        : '/api/trades/chart-markers'
    const rows = await api<
      Array<{ time: number; side: string; won?: boolean | null }>
    >(path)
    setMarkers(rows)
  }, [paperAccountId])

  useEffect(() => {
    void refreshAccount()
    void loadMarket()
    void loadMarkers()

    const conn = createTradingConnection()
    conn.on('BalanceUpdated', () => void refreshAccount())
    conn.on('EngineStatus', () => void refreshAccount())
    conn.on('MarketWindowUpdated', () => void loadMarket())
    conn.on('TradePlaced', () => {
      void loadMarkers()
      setTradeRefreshKey((k) => k + 1)
      void refreshAccount()
    })
    conn.start().catch(console.error)

    const marketPoll = setInterval(() => void loadMarket(), 5000)
    return () => {
      clearInterval(marketPoll)
      void conn.stop()
    }
  }, [refreshAccount, loadMarket, loadMarkers])

  const isPaper = (balance?.mode ?? settings?.tradingMode) === 'Paper'
  const displayBalance =
    balance?.paperBalance ??
    settings?.activePaperBalance ??
    null

  const maxBalance = Math.max(...history.map((x) => x.value), 1)

  return (
    <div className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2">
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={
              isPaper && balance?.paperAccountName
                ? `Paper: ${balance.paperAccountName}`
                : 'Paper balance'
            }
            value={
              displayBalance != null ? `$${displayBalance.toFixed(2)}` : '—'
            }
            hint={isPaper ? 'Simulated · live Polymarket prices' : undefined}
          />
          <StatCard
            label="Live USDC"
            value={
              balance?.liveBalance != null
                ? `$${balance.liveBalance.toFixed(2)}`
                : '—'
            }
          />
          <StatCard
            label="Mode"
            value={balance?.mode ?? settings?.tradingMode ?? '—'}
          />
        </div>
        {connectivity && (
          <div className="rounded-lg border border-[#1e2633] bg-[#12161e] px-3 py-2 text-sm">
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[#9ca3af]">
              <li>Binance: {connectivity.binance}</li>
              <li>Polymarket WS: {connectivity.polymarketMarketWs}</li>
              <li>CLOB: {connectivity.polymarketClob}</li>
            </ul>
          </div>
        )}
      </div>

      <div className="grid min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
          <MarketProgressBar market={market} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#1e2633] bg-[#12161e]">
            <LiveChart candles={candles} timeframe="5m" engineMarkers={markers} />
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-2 overflow-hidden">
          <EngineControls settings={settings} onUpdated={refreshAccount} />
          <div className="shrink-0 rounded-xl border border-[#1e2633] bg-[#12161e] p-4">
            <h2 className="mb-3 text-sm font-medium">Balance history</h2>
            <div className="flex h-20 items-end gap-0.5">
              {history.length === 0 ? (
                <p className="text-sm text-[#9ca3af]">No history yet</p>
              ) : (
                history.slice(-60).map((p) => (
                  <div
                    key={p.time}
                    className="flex-1 bg-[#3dd6c6]/60"
                    style={{
                      height: `${Math.max(4, (p.value / maxBalance) * 100)}%`,
                    }}
                    title={`$${p.value.toFixed(2)}`}
                  />
                ))
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-[#1e2633] bg-[#12161e] p-3">
            <h2 className="shrink-0 text-sm font-medium">Trade history</h2>
            <TradeHistoryTable
              refreshKey={tradeRefreshKey}
              paperAccountId={paperAccountId}
              tradingMode={balance?.mode ?? settings?.tradingMode}
              className="min-h-0 flex-1 overflow-y-auto pr-1"
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-[#1e2633] bg-[#12161e] px-3 py-2">
      <p className="text-xs text-[#9ca3af]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[#3dd6c6]">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[#6b7280]">{hint}</p>}
    </div>
  )
}
