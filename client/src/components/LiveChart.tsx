import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import type { ChartCandle } from '@/types/candle'
import type { Timeframe } from '@/types/timeframe'
import { lastMarketDataCandles } from '@/constants/marketData'
import { DEFAULT_TREND_BET_STRATEGY_PARAMS } from '@/types/trendBetStrategy'
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
import { ChartContextMenu, type ChartContextMenuAnchor } from '@/components/ChartContextMenu'
import { ChartSettingsDialog } from '@/components/ChartSettingsDialog'
import {
  DEFAULT_CHART_DISPLAY_PREFS,
  loadChartDisplayPrefs,
  saveChartDisplayPrefs,
  type ChartDisplayPrefs,
} from '@/lib/chartDisplayPrefs'
import { GLOBAL_RESET_EVENT } from '@/lib/appReset'
import { getChartPalette } from '@/lib/chartTheme'
import { cn } from '@/lib/utils'
import { BetMarkersPrimitive } from '@/utils/chartPrimitives/BetMarkersPrimitive'
import { BosOverlayPrimitive } from '@/utils/chartPrimitives/BosOverlayPrimitive'
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
  const surfaceRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ChartContextMenuAnchor | null>(
    null,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [displayPrefs, setDisplayPrefs] = useState<ChartDisplayPrefs>(
    loadChartDisplayPrefs,
  )
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const bosOverlayRef = useRef<BosOverlayPrimitive | null>(null)
  const betMarkersRef = useRef<BetMarkersPrimitive | null>(null)
  const engineMarkersRef = useRef<EngineMarkersPrimitive | null>(null)
  const isInitializedRef = useRef(false)
  const prevCandleCountRef = useRef(0)
  const lastHorizScrollRef = useRef<number | null>(null)
  const [isLayoutReady, setIsLayoutReady] = useState(false)

  const chartCandles = useMemo(
    () => lastMarketDataCandles(candles),
    [candles],
  )

  const strategySimulation = useMemo(() => {
    if (chartCandles.length === 0) return null
    return simulateTrendBetStrategy(
      chartCandles,
      undefined,
      DEFAULT_TREND_BET_STRATEGY_PARAMS,
    )
  }, [chartCandles])

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

  const handleDisplayPrefsChange = useCallback((next: ChartDisplayPrefs) => {
    setDisplayPrefs(next)
    saveChartDisplayPrefs(next)
  }, [])

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
      setDisplayPrefs({ ...DEFAULT_CHART_DISPLAY_PREFS })
      setContextMenu(null)
      setSettingsOpen(false)
    }
    window.addEventListener(GLOBAL_RESET_EVENT, onGlobalReset)
    return () => window.removeEventListener(GLOBAL_RESET_EVENT, onGlobalReset)
  }, [])

  useEffect(() => {
    if (loading || chartCandles.length === 0) {
      setIsLayoutReady(false)
    }
  }, [loading, chartCandles.length])

  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return

    const container = containerRef.current
    const chartHeight = Math.max(1, container.clientHeight || height || 320)
    const palette = getChartPalette()
    const chart = createChart(container, {
      width: container.clientWidth,
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

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: Math.max(1, containerRef.current.clientHeight || height || 320),
      })
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

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
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
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
    series.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    })
  }, [theme])

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
        'flex min-h-0 w-full flex-col overflow-hidden',
        fillParent ? 'h-full' : undefined,
        className,
      )}
      style={fillParent ? undefined : { height }}
    >
      <div
        className={cn(
          'relative min-h-0 w-full',
          fillParent ? 'flex-1' : undefined,
        )}
        style={fillParent ? undefined : { height: height ?? 420 }}
      >
        <div
          ref={surfaceRef}
          className="relative h-full w-full"
          onContextMenu={handleSurfaceContextMenu}
        >
          <div
            ref={containerRef}
            className="h-full w-full"
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
