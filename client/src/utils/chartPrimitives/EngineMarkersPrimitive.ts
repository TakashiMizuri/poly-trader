import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { ChartCandle } from '@/types/candle'
import { findNearestCandleByTimestamp } from '@/utils/chart/findNearestCandle'
import type { MarketTrend } from '@/utils/chart/detectBreakOfStructure'
import { timeToCoordinateNearest } from '@/utils/chartPrimitives/timeScaleCoordinate'

export interface EngineChartMarker {
  time: number
  side: string
  trend?: string
  won?: boolean | null
}

const WIN_COLOR = '#3dd6c6'
const LOSS_COLOR = '#f07178'
const PENDING_COLOR = '#8b95a8'
const LABEL_OFFSET_PX = 14

function resolveTrend(marker: EngineChartMarker): MarketTrend {
  const t = marker.trend?.toLowerCase()
  if (t === 'long' || t === 'short') return t
  const side = marker.side.toLowerCase()
  if (side === 'buy' || side === 'long') return 'long'
  return 'short'
}

class EngineMarkersPaneRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: EngineMarkersPrimitive

  constructor(primitive: EngineMarkersPrimitive) {
    this.primitive = primitive
  }

  draw(target: {
    useBitmapCoordinateSpace: (
      callback: (scope: {
        context: CanvasRenderingContext2D
        horizontalPixelRatio: number
        verticalPixelRatio: number
      }) => void,
    ) => void
  }) {
    const markers = this.primitive.getMarkers()
    if (markers.length === 0) return

    const chart = this.primitive.getChart()
    const series = this.primitive.getSeries()
    const candles = this.primitive.getCandles()
    if (!chart || !series || candles.length === 0) return

    const timeScale = chart.timeScale()

    target.useBitmapCoordinateSpace(
      ({ context, horizontalPixelRatio, verticalPixelRatio }) => {
        const fontSize = Math.max(
          9,
          Math.round(10 * Math.min(horizontalPixelRatio, verticalPixelRatio)),
        )
        context.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'

        for (const marker of markers) {
          const candle = findNearestCandleByTimestamp(candles, marker.time)
          if (!candle) continue

          const trend = resolveTrend(marker)
          const x = timeToCoordinateNearest(timeScale, candle.time)
          const anchorPrice = trend === 'long' ? candle.low : candle.high
          const y = series.priceToCoordinate(anchorPrice)
          if (x === null || typeof y !== 'number' || !Number.isFinite(y)) continue

          const px = Math.round(x * horizontalPixelRatio)
          const py = Math.round(
            (trend === 'long' ? y + LABEL_OFFSET_PX : y - LABEL_OFFSET_PX) *
              verticalPixelRatio,
          )

          if (marker.won === true) context.fillStyle = WIN_COLOR
          else if (marker.won === false) context.fillStyle = LOSS_COLOR
          else context.fillStyle = PENDING_COLOR

          context.fillText(trend === 'long' ? 'L' : 'S', px, py)
        }
      },
    )
  }
}

class EngineMarkersPaneView implements IPrimitivePaneView {
  private readonly primitive: EngineMarkersPrimitive

  constructor(primitive: EngineMarkersPrimitive) {
    this.primitive = primitive
  }

  renderer() {
    return new EngineMarkersPaneRenderer(this.primitive)
  }
}

export class EngineMarkersPrimitive implements ISeriesPrimitive<Time> {
  private markers: EngineChartMarker[] = []
  private candles: ChartCandle[] = []
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: () => void = () => {}

  constructor(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    markers: EngineChartMarker[] = [],
    candles: ChartCandle[] = [],
  ) {
    this.chart = chart
    this.series = series
    this.markers = markers
    this.candles = candles
  }

  attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.requestUpdate = param.requestUpdate
    this.series = param.series as ISeriesApi<'Candlestick'>
    this.chart = param.chart
  }

  detached(): void {
    this.chart = null
    this.series = null
  }

  paneViews() {
    return [new EngineMarkersPaneView(this)]
  }

  getChart() {
    return this.chart
  }

  getSeries() {
    return this.series
  }

  getMarkers() {
    return this.markers
  }

  getCandles() {
    return this.candles
  }

  setMarkers(markers: EngineChartMarker[], candles: ChartCandle[]) {
    this.markers = markers
    this.candles = candles
    this.requestUpdate()
  }
}
