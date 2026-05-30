import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { api } from '@/api/client'
import { usePoll } from '@/api/hooks'
import { useTradingLiveEvent } from '@/api/tradingLive'
import { PageCard, Skeleton } from '@/components/app-ui'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/context/ThemeContext'
import { useTimeFormat } from '@/context/TimeFormatContext'
import { GLOBAL_RESET_EVENT } from '@/lib/appReset'
import { buildChartTimeLocalization } from '@/lib/displayLocale'
import { getChartPalette } from '@/lib/chartTheme'
import { cn } from '@/lib/utils'

export interface BalanceHistoryPoint {
  time: number
  value: number
}

export interface TradePayoutPoint {
  time: number
  ratio: number
  won: boolean
  tradeId: number
}

export interface BalanceHistoryResponse {
  initialBalance: number
  actual: BalanceHistoryPoint[]
  expected: BalanceHistoryPoint[]
  payoutRatios: TradePayoutPoint[]
  mode: string
  commissionPercent: number
}

type ChartView = 'equity' | 'payout'

interface Props {
  paperAccountId?: number | null
  tradingMode?: string
  liveBalance?: number | null
  clobConfigured?: boolean
  className?: string
}

/** lightweight-charts requires strictly ascending unique timestamps. */
function toSeriesData(points: BalanceHistoryPoint[]) {
  if (points.length === 0) return []

  const sorted = [...points].sort((a, b) => a.time - b.time)
  const out: { time: import('lightweight-charts').Time; value: number }[] = []

  for (const p of sorted) {
    const last = out[out.length - 1]
    if (last != null && last.time === p.time) {
      last.value = p.value
    } else {
      out.push({
        time: p.time as import('lightweight-charts').Time,
        value: p.value,
      })
    }
  }

  return out
}

/** Wins: green bars up (+ratio). Losses: red bars down (−ratio). */
function toPayoutHistogramData(
  points: TradePayoutPoint[],
  winColor: string,
  lossColor: string,
) {
  if (points.length === 0) return []

  const sorted = [...points].sort((a, b) => a.time - b.time)
  const out: {
    time: import('lightweight-charts').Time
    value: number
    color: string
  }[] = []

  for (const p of sorted) {
    const last = out[out.length - 1]
    const signed = p.won ? p.ratio : -p.ratio
    const bar = {
      time: p.time as import('lightweight-charts').Time,
      value: signed,
      color: p.won ? winColor : lossColor,
    }
    if (last != null && last.time === p.time) {
      out[out.length - 1] = bar
    } else {
      out.push(bar)
    }
  }

  return out
}

function EquityLegend() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-4 rounded-full"
          style={{ background: 'var(--color-chart-equity)' }}
        />
        Actual
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-4 rounded-full opacity-80"
          style={{
            background: 'var(--color-chart-expected)',
            boxShadow: '0 0 0 1px var(--color-chart-expected)',
          }}
        />
        Expected
      </span>
    </div>
  )
}

function PayoutLegend() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2 rounded-sm"
          style={{ background: 'var(--color-chart-up)' }}
        />
        Win ↑
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2 rounded-sm"
          style={{ background: 'var(--color-chart-down)' }}
        />
        Loss ↓
      </span>
    </div>
  )
}

function ChartViewToggle({
  view,
  onChange,
}: {
  view: ChartView
  onChange: (view: ChartView) => void
}) {
  return (
    <div className="flex max-w-full shrink-0 rounded-md border border-border p-0.5 sm:rounded-lg">
      <Button
        type="button"
        size="xs"
        variant={view === 'equity' ? 'secondary' : 'ghost'}
        className="h-6 min-w-0 px-1.5 text-[10px] sm:px-2 sm:text-[11px]"
        onClick={() => onChange('equity')}
      >
        Equity
      </Button>
      <Button
        type="button"
        size="xs"
        variant={view === 'payout' ? 'secondary' : 'ghost'}
        className="h-6 min-w-0 px-1.5 text-[10px] sm:px-2 sm:text-[11px]"
        onClick={() => onChange('payout')}
      >
        Payout ×
      </Button>
    </div>
  )
}

export function DashboardBalanceChart({
  paperAccountId,
  tradingMode,
  liveBalance,
  clobConfigured,
  className,
}: Props) {
  const { theme } = useTheme()
  const { timeFormat, useLocalTime } = useTimeFormat()
  const [chartView, setChartView] = useState<ChartView>('equity')
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const actualRef = useRef<ISeriesApi<'Line'> | null>(null)
  const expectedRef = useRef<ISeriesApi<'Line'> | null>(null)
  const payoutRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const cacheKey = `api/balance/history:${paperAccountId ?? 'live'}:${tradingMode ?? ''}`

  const fetchHistory = useCallback(async () => {
    const params = new URLSearchParams({ limit: '500' })
    if (paperAccountId != null) {
      params.set('paperAccountId', String(paperAccountId))
    } else {
      params.set('mode', 'Live')
    }
    return api<BalanceHistoryResponse>(`/api/balance/history?${params}`)
  }, [paperAccountId])

  const poll = usePoll(fetchHistory, false, { cacheKey })
  const history = poll.data

  useTradingLiveEvent('BalanceUpdated', () => void poll.refresh())
  useTradingLiveEvent('TradePlaced', () => void poll.refresh())
  useTradingLiveEvent('CandleClosed', () => void poll.refresh())

  useEffect(() => {
    const onReset = () => void poll.refresh()
    window.addEventListener(GLOBAL_RESET_EVENT, onReset)
    return () => window.removeEventListener(GLOBAL_RESET_EVENT, onReset)
  }, [poll.refresh])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const palette = getChartPalette()
    const expectedColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-chart-expected')
        .trim() || '#a78bfa'

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: palette.background },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border, timeVisible: true },
      width: Math.max(1, Math.floor(container.clientWidth)),
      height: Math.max(1, Math.floor(container.clientHeight)),
    })

    const actualSeries = chart.addSeries(LineSeries, {
      color: palette.equity,
      lineWidth: 2,
      title: tradingMode === 'Live' ? 'Live' : 'Actual',
      visible: true,
    })

    const expectedSeries = chart.addSeries(LineSeries, {
      color: expectedColor,
      lineWidth: 2,
      lineStyle: 2,
      title: 'Expected',
      visible: true,
    })

    const payoutSeries = chart.addSeries(HistogramSeries, {
      color: palette.up,
      priceFormat: {
        type: 'custom',
        formatter: (value: number) => `${Math.abs(value).toFixed(2)}×`,
      },
      title: '|PnL| / stake',
      visible: false,
      base: 0,
    })

    chartRef.current = chart
    actualRef.current = actualSeries
    expectedRef.current = expectedSeries
    payoutRef.current = payoutSeries

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: Math.max(1, Math.floor(container.clientWidth)),
        height: Math.max(1, Math.floor(container.clientHeight)),
      })
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      actualRef.current = null
      expectedRef.current = null
      payoutRef.current = null
    }
  }, [theme, tradingMode])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyOptions(buildChartTimeLocalization(timeFormat, useLocalTime))
  }, [timeFormat, useLocalTime])

  const isPaper = tradingMode === 'Paper'
  const currentBalance =
    history?.actual[history.actual.length - 1]?.value ??
    (isPaper ? null : liveBalance ?? null)

  const actualSeries = useMemo(() => {
    if (history != null && history.actual.length > 0) {
      return history.actual
    }
    if (!isPaper && liveBalance != null) {
      return [{ time: Math.floor(Date.now() / 1000), value: liveBalance }]
    }
    return []
  }, [history, isPaper, liveBalance])

  const payoutSeries = useMemo(
    () => history?.payoutRatios ?? [],
    [history?.payoutRatios],
  )

  useEffect(() => {
    const chart = chartRef.current
    const actual = actualRef.current
    const expected = expectedRef.current
    const payout = payoutRef.current
    if (!chart || !actual || !expected || !payout) return

    const palette = getChartPalette()
    const isEquity = chartView === 'equity'

    actual.applyOptions({ visible: isEquity })
    expected.applyOptions({ visible: isEquity })
    payout.applyOptions({ visible: !isEquity })

    const priceScale = chart.priceScale('right')
    if (isEquity) {
      priceScale.applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })
      actual.setData(toSeriesData(actualSeries))
      expected.setData(toSeriesData(history?.expected ?? []))
      payout.setData([])
      if (actualSeries.length > 0) {
        chart.timeScale().fitContent()
      }
    } else {
      priceScale.applyOptions({
        scaleMargins: { top: 0.12, bottom: 0.12 },
      })
      actual.setData([])
      expected.setData([])
      const bars = toPayoutHistogramData(
        payoutSeries,
        palette.up,
        palette.down,
      )
      payout.setData(bars)
      if (bars.length > 0) {
        chart.timeScale().fitContent()
      }
    }
  }, [chartView, history, actualSeries, payoutSeries, theme])

  const title =
    chartView === 'payout'
      ? isPaper
        ? 'Paper payout ratio'
        : 'Live payout ratio'
      : isPaper
        ? 'Paper equity'
        : 'Live equity'

  const headerMeta = useMemo(() => {
    if (chartView === 'payout') {
      if (payoutSeries.length === 0) return null
      const won = payoutSeries.filter((p) => p.won)
      const losses = payoutSeries.length - won.length
      const avgWin =
        won.length > 0
          ? won.reduce((sum, p) => sum + p.ratio, 0) / won.length
          : 0
      return `${payoutSeries.length} trades · ${won.length}W / ${losses}L · win avg ${avgWin.toFixed(2)}×`
    }

    const parts: string[] = []
    if (currentBalance != null) {
      parts.push(`$${currentBalance.toFixed(2)}`)
    }
    if (history != null && history.actual.length > 0) {
      parts.push(`${history.actual.length} pts`)
    }
    if (history != null) {
      parts.push(`${history.commissionPercent}% fee`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
  }, [chartView, currentBalance, history, payoutSeries])

  const emptyEquity = actualSeries.length === 0 && currentBalance == null
  const emptyPayout = payoutSeries.length === 0
  const empty = chartView === 'equity' ? emptyEquity : emptyPayout

  return (
    <PageCard
      title={title}
      className={cn('flex min-h-[200px] min-w-0 max-w-full flex-col', className)}
      contentClassName="relative min-h-0 flex-1 overflow-hidden p-0"
      action={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 sm:flex-nowrap sm:gap-3">
          <ChartViewToggle view={chartView} onChange={setChartView} />
          {headerMeta ? (
            <span
              className="hidden truncate font-mono text-[11px] tabular-nums text-muted-foreground sm:inline"
              title={headerMeta}
            >
              {headerMeta}
            </span>
          ) : clobConfigured === false ? (
            <span className="hidden text-[11px] text-warn sm:inline">
              Set POLYMARKET_PRIVATE_KEY
            </span>
          ) : chartView === 'equity' ? (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              5m snapshots
            </span>
          ) : (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              per settled trade
            </span>
          )}
          <span className="hidden sm:contents">
            {chartView === 'equity' ? <EquityLegend /> : <PayoutLegend />}
          </span>
        </div>
      }
    >
      {poll.loading && history == null ? (
        <Skeleton shimmer className="absolute inset-0 rounded-none" />
      ) : null}
      {empty ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {chartView === 'payout' ? (
            'Settled trades: green ↑ wins, red ↓ losses (|PnL| ÷ stake).'
          ) : clobConfigured === false ? (
            'Polymarket key not configured on the API.'
          ) : (
            'Snapshots appear after each 5m candle while the engine runs.'
          )}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="absolute inset-0 min-w-0 max-w-full overflow-hidden"
      />
    </PageCard>
  )
}
