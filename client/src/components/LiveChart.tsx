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
import {
  analyzeTrendAndBos,
  BOS_MAX_CANDLES,
  bosOptionsFromTrendBetParams,
} from '@/utils/chart/detectBreakOfStructure'
import { simulateTrendBetStrategy } from '@/utils/chart/simulateTrendBetStrategy'
import type { TrendBetStrategyParams } from '@/types/trendBetStrategy'
import {
  loadTrendBetStrategyParams,
  normalizeTrendBetStrategyParams,
  saveTrendBetStrategyParams,
} from '@/lib/trendBetStrategyParams'
import {
  TrendStrategyPanel,
  loadChartLayers,
  saveChartLayers,
  type ChartLayerVisibility,
} from '@/components/TrendStrategyPanel'
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
import { getChartPalette } from '@/lib/chartTheme'
import { cn } from '@/lib/utils'
import { BosOverlayPrimitive } from '@/utils/chartPrimitives/BosOverlayPrimitive'
import { BetMarkersPrimitive } from '@/utils/chartPrimitives/BetMarkersPrimitive'
import {
  EngineMarkersPrimitive,
  type EngineChartMarker,
} from '@/utils/chartPrimitives/EngineMarkersPrimitive'

interface LiveChartProps {
  candles: ChartCandle[]
  timeframe?: Timeframe
  engineMarkers?: EngineChartMarker[]
  /** Fixed height in px; omit when parent supplies height via flex (fillHeight). */
  height?: number
  className?: string
}

export function LiveChart({
  candles,
  timeframe = '5m',
  engineMarkers = [],
  height,
  className,
}: LiveChartProps) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const equitySeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bosOverlayRef = useRef<BosOverlayPrimitive | null>(null)
  const betMarkersRef = useRef<BetMarkersPrimitive | null>(null)
  const engineMarkersRef = useRef<EngineMarkersPrimitive | null>(null)
  const isInitializedRef = useRef(false)
  const prevCandleCountRef = useRef(0)
  const lastHorizScrollRef = useRef<number | null>(null)

  const [strategyParams, setStrategyParams] = useState<TrendBetStrategyParams>(
    loadTrendBetStrategyParams,
  )
  const [chartLayers, setChartLayers] = useState<ChartLayerVisibility>(loadChartLayers)

  const handleStrategyParamsChange = useCallback(
    (next: TrendBetStrategyParams) => {
      const normalized = normalizeTrendBetStrategyParams(next)
      setStrategyParams(normalized)
      saveTrendBetStrategyParams(normalized)
    },
    [],
  )

  const handleChartLayersChange = useCallback((next: ChartLayerVisibility) => {
    setChartLayers(next)
    saveChartLayers(next)
  }, [])

  const bosCandles = useMemo(
    () => (candles.length > 0 ? candles.slice(-BOS_MAX_CANDLES) : []),
    [candles],
  )

  const bosAnalysis = useMemo(
    () =>
      bosCandles.length > 0
        ? analyzeTrendAndBos(
            bosCandles,
            bosOptionsFromTrendBetParams(strategyParams),
          )
        : {
            lines: [],
            segments: [],
            trendAtOpen: [],
            bosFlipAt: [],
            trendForNextOpen: 'long' as const,
          },
    [
      bosCandles,
      strategyParams.structureLookback,
      strategyParams.bosMinSegmentBars,
      strategyParams.bosMinBarsBetweenFlips,
      strategyParams.bosBreakBuffer,
      strategyParams.bosBodyBreakOnly,
    ],
  )

  const strategySimulation = useMemo(() => {
    if (
      bosCandles.length === 0 ||
      bosAnalysis.trendAtOpen.length !== bosCandles.length
    ) {
      return null
    }
    return simulateTrendBetStrategy(
      bosCandles,
      bosAnalysis.trendAtOpen,
      strategyParams,
      bosAnalysis.bosFlipAt,
    )
  }, [bosCandles, bosAnalysis, strategyParams])

  const displayBosAnalysis = useMemo(() => {
    if (chartLayers.bosOverlay) return bosAnalysis
    return {
      lines: [],
      segments: [],
      trendAtOpen: [] as typeof bosAnalysis.trendAtOpen,
      bosFlipAt: [] as typeof bosAnalysis.bosFlipAt,
      trendForNextOpen: 'long' as const,
    }
  }, [bosAnalysis, chartLayers.bosOverlay])

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

    chart.priceScale('left').applyOptions({
      visible: true,
      borderColor: palette.border,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    })

    const equitySeries = chart.addSeries(LineSeries, {
      priceScaleId: 'left',
      color: palette.equity,
      lineWidth: 2,
      title: 'Balance $',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `$${price.toFixed(0)}`,
      },
    })
    equitySeriesRef.current = equitySeries

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
      equitySeriesRef.current = null
      isInitializedRef.current = false
      prevCandleCountRef.current = 0
      lastHorizScrollRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    const equitySeries = equitySeriesRef.current
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
    chart.priceScale('left').applyOptions({ borderColor: palette.border })
    equitySeries?.applyOptions({ color: palette.equity })
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
    const equitySeries = equitySeriesRef.current
    if (!equitySeries) return
    if (!strategySimulation || !chartLayers.equityCurve) {
      equitySeries.setData([])
      return
    }
    const equityData = strategySimulation.equityCurve.map((point) => ({
      time: point.time as Time,
      value: point.value,
    }))
    equitySeries.setData(equityData.length > 0 ? equityData : [])
  }, [strategySimulation, chartLayers.equityCurve])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !isInitializedRef.current) return

    const bets =
      chartLayers.betMarkers && strategySimulation ? strategySimulation.bets : []
    if (!betMarkersRef.current) {
      const primitive = new BetMarkersPrimitive(chart, series, bets)
      series.attachPrimitive(primitive)
      betMarkersRef.current = primitive
      return
    }
    betMarkersRef.current.setBets(bets)
  }, [strategySimulation, chartLayers.betMarkers])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !isInitializedRef.current) return

    const markers = chartLayers.engineMarkers ? engineMarkers : []
    if (!engineMarkersRef.current) {
      const primitive = new EngineMarkersPrimitive(
        chart,
        series,
        markers,
        candles,
      )
      series.attachPrimitive(primitive)
      engineMarkersRef.current = primitive
      return
    }
    engineMarkersRef.current.setMarkers(markers, candles)
  }, [engineMarkers, candles, chartLayers.engineMarkers])

  useEffect(() => {
    if (!seriesRef.current || !isInitializedRef.current) return
    if (candles.length === 0) {
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

    const chartData = buildSeriesDataWithFutureWhitespace(candles, timeframe)
    const seriesLogicalLength = chartData.length
    seriesRef.current.setData(chartData)

    if (chart) {
      applyTimeScaleBaseOptions(chart.timeScale())

      if (!isFirstPopulation && scrollToRestore !== null) {
        restoreTimeScaleScroll(
          chart.timeScale(),
          chartRef,
          scrollToRestore,
          (v) => {
            lastHorizScrollRef.current = v
          },
        )
        prevCandleCountRef.current = candles.length
      } else {
        requestAnimationFrame(() => {
          if (!chartRef.current) return
          const tscale = chartRef.current.timeScale()
          if (isFirstPopulation) {
            applyInitialTimeScaleWindow(
              tscale,
              seriesLogicalLength,
              getInitialVisibleBarCount(timeframe),
            )
          }
          sampleScrollIntoRef(tscale, (v) => {
            lastHorizScrollRef.current = v
          })
          prevCandleCountRef.current = candles.length
        })
      }
    } else {
      prevCandleCountRef.current = candles.length
    }
  }, [candles, timeframe])

  const fillParent = height == null

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
        <div ref={containerRef} className="h-full w-full" />
        {strategySimulation && (
          <TrendStrategyPanel
            simulation={strategySimulation}
            candleCount={bosCandles.length}
            params={strategyParams}
            onParamsChange={handleStrategyParamsChange}
            layers={chartLayers}
            onLayersChange={handleChartLayersChange}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-border px-1 py-1.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-primary/35" />
            Long trend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-destructive/35" />
            Short trend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-warn">—</span>
            Bullish BoS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-chart-3">—</span>
            Bearish BoS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-primary">+</span>
            <span className="font-semibold text-destructive">-</span>
            Win / loss
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-primary">L</span>
            <span className="font-semibold text-destructive">S</span>
            Engine trades
          </span>
        </div>
      </div>
    </div>
  )
}
