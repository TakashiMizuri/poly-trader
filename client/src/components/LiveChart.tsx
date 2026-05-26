import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { ChartCandle } from '@/types/candle'
import type { Timeframe } from '@/types/timeframe'
import { analyzeTrendAndBos } from '@/utils/chart/detectBreakOfStructure'
import { simulateTrendBetStrategy } from '@/utils/chart/simulateTrendBetStrategy'
import {
  applyInitialTimeScaleWindow,
  applyTimeScaleBaseOptions,
  captureTimeScaleScroll,
  resolveScrollToRestore,
  restoreTimeScaleScroll,
  sampleScrollIntoRef,
  STANDARD_TIME_AXIS_RIGHT_OFFSET,
} from '@/utils/chart/chartTimeScale'
import {
  buildSeriesDataWithFutureWhitespace,
  getInitialVisibleBarCount,
} from '@/utils/chart/futureWhitespaceSeries'
import { useTheme } from '@/context/ThemeContext'
import { useTimeFormat } from '@/context/TimeFormatContext'
import { buildChartTimeLocalization } from '@/lib/displayLocale'
import { ChartContextMenu, type ChartContextMenuAnchor } from '@/components/ChartContextMenu'
import { ChartSettingsDialog } from '@/components/ChartSettingsDialog'
import { filterCandlesForChartRange } from '@/lib/chartCandleRange'
import {
  chartBacktestToStrategyParams,
  DEFAULT_CHART_DISPLAY_PREFS,
  type ChartDisplayPrefs,
} from '@/lib/chartDisplayPrefs'
import { useChartDisplayPrefs } from '@/hooks/useChartDisplayPrefs'
import { GLOBAL_RESET_EVENT } from '@/lib/appReset'
import { chartEquityLineColor, getChartPalette } from '@/lib/chartTheme'
import { cn } from '@/lib/utils'
import { BetMarkersPrimitive } from '@/utils/chartPrimitives/BetMarkersPrimitive'
import { BosOverlayPrimitive } from '@/utils/chartPrimitives/BosOverlayPrimitive'
import {
  BacktestStatsPanePrimitive,
  type BacktestStatsData,
} from '@/utils/chartPrimitives/BacktestStatsPanePrimitive'
import {
  EngineMarkersPrimitive,
  type EngineChartMarker,
} from '@/utils/chartPrimitives/EngineMarkersPrimitive'

interface LiveChartProps {
  candles: ChartCandle[]
  timeframe?: Timeframe
  engineMarkers?: EngineChartMarker[]
  /** Show a centered spinner while candle history is loading. */
  loading?: boolean
  /** Fixed height in px; omit when parent supplies height via flex (fillHeight). */
  height?: number
  className?: string
}

export function LiveChart({
  candles,
  timeframe = '5m',
  engineMarkers = [],
  loading = false,
  height,
  className,
}: LiveChartProps) {
  const { theme } = useTheme()
  const { timeFormat, useLocalTime } = useTimeFormat()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ChartContextMenuAnchor | null>(
    null,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [displayPrefs, setDisplayPrefs] = useChartDisplayPrefs()
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const equitySeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bosOverlayRef = useRef<BosOverlayPrimitive | null>(null)
  const betMarkersRef = useRef<BetMarkersPrimitive | null>(null)
  const engineMarkersRef = useRef<EngineMarkersPrimitive | null>(null)
  const backtestStatsRef = useRef<BacktestStatsPanePrimitive | null>(null)
  const isInitializedRef = useRef(false)
  const prevCandleCountRef = useRef(0)
  const lastHorizScrollRef = useRef<number | null>(null)
  const [isLayoutReady, setIsLayoutReady] = useState(false)

  const chartCandles = useMemo(
    () => filterCandlesForChartRange(candles, displayPrefs),
    [
      candles,
      displayPrefs.candleRangeMode,
      displayPrefs.candleRangeFromMs,
      displayPrefs.maxCandles,
    ],
  )

  const strategyParams = useMemo(
    () => chartBacktestToStrategyParams(displayPrefs.backtest),
    [displayPrefs.backtest],
  )

  const strategySimulation = useMemo(() => {
    if (chartCandles.length === 0) return null
    return simulateTrendBetStrategy(chartCandles, undefined, strategyParams)
  }, [chartCandles, strategyParams])

  const backtestStats = useMemo((): BacktestStatsData | null => {
    if (!strategySimulation) return null
    return {
      maxDrawdown: strategySimulation.maxDrawdown,
      maxDrawdownPct: strategySimulation.maxDrawdownPct,
      winRate: strategySimulation.winRate,
      netPnl: strategySimulation.netPnl,
      totalBets: strategySimulation.totalBets,
    }
  }, [strategySimulation])

  const bosAnalysis = useMemo(
    () =>
      chartCandles.length > 0
        ? analyzeTrendAndBos(chartCandles)
        : {
            lines: [],
            segments: [],
            trendAtOpen: [],
            bosFlipAt: [],
            trendForNextOpen: 'long' as const,
          },
    [chartCandles],
  )

  const displayBosAnalysis = useMemo(
    () => ({
      ...bosAnalysis,
      segments: displayPrefs.showTrends ? bosAnalysis.segments : [],
      lines: displayPrefs.showBosOverlay ? bosAnalysis.lines : [],
    }),
    [bosAnalysis, displayPrefs.showTrends, displayPrefs.showBosOverlay],
  )

  const handleDisplayPrefsChange = useCallback(
    (next: ChartDisplayPrefs) => {
      setDisplayPrefs(next)
    },
    [setDisplayPrefs],
  )

  const openContextMenu = useCallback((clientX: number, clientY: number) => {
    const surface = surfaceRef.current
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    setContextMenu({
      x: clientX - rect.left,
      y: clientY - rect.top,
    })
  }, [])

  const handleSurfaceContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      openContextMenu(event.clientX, event.clientY)
    },
    [openContextMenu],
  )

  useEffect(() => {
    const onGlobalReset = () => {
      const defaults = {
        ...DEFAULT_CHART_DISPLAY_PREFS,
        backtest: { ...DEFAULT_CHART_DISPLAY_PREFS.backtest },
      }
      setDisplayPrefs(defaults)
      setContextMenu(null)
      setSettingsOpen(false)
    }
    window.addEventListener(GLOBAL_RESET_EVENT, onGlobalReset)
    return () => window.removeEventListener(GLOBAL_RESET_EVENT, onGlobalReset)
  }, [setDisplayPrefs])

  useEffect(() => {
    if (loading || chartCandles.length === 0) {
      setIsLayoutReady(false)
    }
  }, [loading, chartCandles.length])

  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return

    const container = containerRef.current
    const surface = surfaceRef.current ?? container
    const chartWidth = Math.max(1, Math.floor(surface.clientWidth))
    const chartHeight = Math.max(
      1,
      Math.floor(surface.clientHeight || height || 320),
    )
    const palette = getChartPalette()
    const chart = createChart(container, {
      width: chartWidth,
      height: chartHeight,
      layout: {
        background: { color: palette.background },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: {
        borderColor: palette.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: STANDARD_TIME_AXIS_RIGHT_OFFSET,
        barSpacing: 8,
        fixRightEdge: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    })

    chartRef.current = chart

    const onLogicalRangeChanged = () => {
      sampleScrollIntoRef(chart.timeScale(), (v) => {
        lastHorizScrollRef.current = v
      })
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRangeChanged)

    chart.priceScale('left').applyOptions({
      visible: true,
      borderColor: palette.border,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    })

    const equitySeries = chart.addSeries(LineSeries, {
      priceScaleId: 'left',
      color: chartEquityLineColor(palette.equity),
      lineWidth: 1,
      title: 'Backtest $',
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `$${price.toFixed(0)}`,
      },
    })
    equitySeriesRef.current = equitySeries

    const series = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      borderVisible: false,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    })
    seriesRef.current = series

    const mainPane = chart.panes()[0]
    if (mainPane) {
      const statsPrimitive = new BacktestStatsPanePrimitive()
      mainPane.attachPrimitive(statsPrimitive)
      backtestStatsRef.current = statsPrimitive
    }

    const handleResize = () => {
      const surface = surfaceRef.current
      if (!surface || !chartRef.current) return
      const nextWidth = Math.max(1, Math.floor(surface.clientWidth))
      const nextHeight = Math.max(
        1,
        Math.floor(surface.clientHeight || height || 320),
      )
      chartRef.current.applyOptions({ width: nextWidth, height: nextHeight })
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(surfaceRef.current ?? container)

    isInitializedRef.current = true
    requestAnimationFrame(handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRangeChanged)
      if (bosOverlayRef.current && seriesRef.current) {
        seriesRef.current.detachPrimitive(bosOverlayRef.current)
        bosOverlayRef.current = null
      }
      if (betMarkersRef.current && seriesRef.current) {
        seriesRef.current.detachPrimitive(betMarkersRef.current)
        betMarkersRef.current = null
      }
      if (engineMarkersRef.current && seriesRef.current) {
        seriesRef.current.detachPrimitive(engineMarkersRef.current)
        engineMarkersRef.current = null
      }
      if (backtestStatsRef.current) {
        const pane = chart.panes()[0]
        pane?.detachPrimitive(backtestStatsRef.current)
        backtestStatsRef.current = null
      }
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      equitySeriesRef.current = null
      isInitializedRef.current = false
      prevCandleCountRef.current = 0
      lastHorizScrollRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !isInitializedRef.current) return

    const palette = getChartPalette()
    chart.applyOptions({
      layout: {
        background: { color: palette.background },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    })
    chart.priceScale('left').applyOptions({ borderColor: palette.border })
    equitySeriesRef.current?.applyOptions({
      color: chartEquityLineColor(palette.equity),
    })
    series.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    })
  }, [theme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !isInitializedRef.current) return
    chart.applyOptions(buildChartTimeLocalization(timeFormat, useLocalTime))
  }, [timeFormat, useLocalTime])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !isInitializedRef.current) return

    if (!bosOverlayRef.current) {
      const overlay = new BosOverlayPrimitive(chart, series, displayBosAnalysis)
      series.attachPrimitive(overlay)
      bosOverlayRef.current = overlay
      return
    }
    bosOverlayRef.current.setAnalysis(displayBosAnalysis)
  }, [displayBosAnalysis])

  useEffect(() => {
    const equitySeries = equitySeriesRef.current
    if (!equitySeries) return
    if (
      !displayPrefs.showEquityCurve ||
      !strategySimulation ||
      strategySimulation.equityCurve.length === 0
    ) {
      equitySeries.setData([])
      return
    }
    const equityData = strategySimulation.equityCurve.map((point) => ({
      time: point.time as Time,
      value: point.value,
    }))
    equitySeries.setData(equityData)
  }, [strategySimulation, displayPrefs.showEquityCurve])

  useEffect(() => {
    const primitive = backtestStatsRef.current
    if (!primitive) return
    primitive.update(backtestStats, displayPrefs.showBacktestStats)
  }, [backtestStats, displayPrefs.showBacktestStats])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !isInitializedRef.current) return

    const bets =
      displayPrefs.showBetMarkers && strategySimulation
        ? strategySimulation.bets
        : []
    if (!betMarkersRef.current) {
      const primitive = new BetMarkersPrimitive(chart, series, bets)
      series.attachPrimitive(primitive)
      betMarkersRef.current = primitive
      return
    }
    betMarkersRef.current.setBets(bets)
  }, [strategySimulation, displayPrefs.showBetMarkers])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !isInitializedRef.current) return

    if (!engineMarkersRef.current) {
      const primitive = new EngineMarkersPrimitive(
        chart,
        series,
        engineMarkers,
        chartCandles,
      )
      series.attachPrimitive(primitive)
      engineMarkersRef.current = primitive
      return
    }
    engineMarkersRef.current.setMarkers(engineMarkers, chartCandles)
  }, [engineMarkers, chartCandles])

  useEffect(() => {
    if (!seriesRef.current || !isInitializedRef.current) return
    if (chartCandles.length === 0) {
      prevCandleCountRef.current = 0
      return
    }

    const chart = chartRef.current
    const savedScroll = captureTimeScaleScroll(chart)
    const isFirstPopulation = prevCandleCountRef.current === 0
    const scrollToRestore = resolveScrollToRestore(
      isFirstPopulation,
      savedScroll,
      lastHorizScrollRef.current,
    )

    const chartData = buildSeriesDataWithFutureWhitespace(chartCandles, timeframe)
    const seriesLogicalLength = chartData.length
    seriesRef.current.setData(chartData)

    if (chart) {
      applyTimeScaleBaseOptions(chart.timeScale())

      if (isFirstPopulation) {
        applyInitialTimeScaleWindow(
          chart.timeScale(),
          seriesLogicalLength,
          getInitialVisibleBarCount(timeframe),
        )
        sampleScrollIntoRef(chart.timeScale(), (v) => {
          lastHorizScrollRef.current = v
        })
        prevCandleCountRef.current = chartCandles.length
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (chartRef.current) setIsLayoutReady(true)
          })
        })
      } else if (scrollToRestore !== null) {
        restoreTimeScaleScroll(
          chart.timeScale(),
          chartRef,
          scrollToRestore,
          (v) => {
            lastHorizScrollRef.current = v
          },
        )
        prevCandleCountRef.current = chartCandles.length
      } else {
        requestAnimationFrame(() => {
          if (!chartRef.current) return
          sampleScrollIntoRef(chartRef.current.timeScale(), (v) => {
            lastHorizScrollRef.current = v
          })
          prevCandleCountRef.current = chartCandles.length
        })
      }
    } else {
      prevCandleCountRef.current = chartCandles.length
    }
  }, [chartCandles, timeframe])

  const fillParent = height == null
  const hasCandles = chartCandles.length > 0
  const showOverlay =
    !hasCandles && (loading || !isLayoutReady)

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden',
        fillParent ? 'h-full' : undefined,
        className,
      )}
      style={fillParent ? undefined : { height }}
    >
      <div
        className={cn(
          'relative min-h-0 w-full min-w-0 max-w-full',
          fillParent ? 'flex-1' : undefined,
        )}
        style={fillParent ? undefined : { height: height ?? 420 }}
      >
        <div
          ref={surfaceRef}
          className="relative h-full w-full min-w-0 max-w-full overflow-hidden"
          onContextMenu={handleSurfaceContextMenu}
        >
          <div
            ref={containerRef}
            className="h-full w-full min-w-0 max-w-full overflow-hidden"
          />
          {showOverlay && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-chart-background"
              aria-busy="true"
              aria-label="Loading chart data"
            >
              {loading && (
                <div className="h-9 w-9 animate-spin rounded-full border-2 border-chart-text/20 border-t-chart-text/70" />
              )}
            </div>
          )}
          {contextMenu && (
            <ChartContextMenu
              anchor={contextMenu}
              containerRef={surfaceRef}
              onChartSettings={() => setSettingsOpen(true)}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
        <ChartSettingsDialog
          open={settingsOpen}
          prefs={displayPrefs}
          onPrefsChange={handleDisplayPrefsChange}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
    </div>
  )
}
