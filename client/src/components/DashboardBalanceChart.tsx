import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { api } from '@/api/client'
import { usePoll } from '@/api/hooks'
import { useTradingLiveEvent } from '@/api/tradingLive'
import { PageCard, Skeleton } from '@/components/app-ui'
import { useTheme } from '@/context/ThemeContext'
import { GLOBAL_RESET_EVENT } from '@/lib/appReset'
import { getChartPalette } from '@/lib/chartTheme'
import { cn } from '@/lib/utils'

export interface BalanceHistoryPoint {
  time: number
  value: number
}

export interface BalanceHistoryResponse {
  initialBalance: number
  actual: BalanceHistoryPoint[]
  expected: BalanceHistoryPoint[]
  mode: string
  commissionPercent: number
}

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

function ChartLegend() {
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

export function DashboardBalanceChart({
  paperAccountId,
  tradingMode,
  liveBalance,
  clobConfigured,
  className,
}: Props) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const actualRef = useRef<ISeriesApi<'Line'> | null>(null)
  const expectedRef = useRef<ISeriesApi<'Line'> | null>(null)

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
    })

    const expectedSeries = chart.addSeries(LineSeries, {
      color: expectedColor,
      lineWidth: 2,
      lineStyle: 2,
      title: 'Expected',
    })

    chartRef.current = chart
    actualRef.current = actualSeries
    expectedRef.current = expectedSeries

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
    }
  }, [theme, tradingMode])

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

  useEffect(() => {
    if (!actualRef.current || !expectedRef.current) return

    actualRef.current.setData(toSeriesData(actualSeries))
    expectedRef.current.setData(
      toSeriesData(history?.expected ?? []),
    )
    if (actualSeries.length > 0) {
      chartRef.current?.timeScale().fitContent()
    }
  }, [history, actualSeries])

  const title = isPaper ? 'Paper equity' : 'Live equity'

  const headerMeta = useMemo(() => {
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
  }, [currentBalance, history])

  const empty = actualSeries.length === 0 && currentBalance == null

  return (
    <PageCard
      title={title}
      className={cn('flex min-h-[200px] min-w-0 max-w-full flex-col', className)}
      contentClassName="relative min-h-0 flex-1 overflow-hidden p-0"
      action={
        <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          {headerMeta ? (
            <span
              className="truncate font-mono text-[11px] tabular-nums text-muted-foreground"
              title={headerMeta}
            >
              {headerMeta}
            </span>
          ) : clobConfigured === false ? (
            <span className="text-[11px] text-warn">Set POLYMARKET_PRIVATE_KEY</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">5m snapshots</span>
          )}
          <ChartLegend />
        </div>
      }
    >
      {poll.loading && history == null ? (
        <Skeleton shimmer className="absolute inset-0 rounded-none" />
      ) : null}
      {empty ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {clobConfigured === false
            ? 'Polymarket key not configured on the API.'
            : 'Snapshots appear after each 5m candle while the engine runs.'}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="absolute inset-0 min-w-0 max-w-full overflow-hidden"
      />
    </PageCard>
  )
}
