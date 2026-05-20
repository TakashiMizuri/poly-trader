import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { BosAnalysis, BosLine, TrendSegment } from '@/utils/chart/detectBreakOfStructure'
import { timeToCoordinateNearest } from '@/utils/chartPrimitives/timeScaleCoordinate'

const BULLISH_BOS_COLOR = '#f59e0b'
const BEARISH_BOS_COLOR = '#a855f7'
const LONG_TREND_FILL = 'rgba(61, 214, 198, 0.12)'
const SHORT_TREND_FILL = 'rgba(239, 68, 68, 0.12)'

class BosOverlayPaneRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: BosOverlayPrimitive

  constructor(primitive: BosOverlayPrimitive) {
    this.primitive = primitive
  }

  draw(target: {
    useBitmapCoordinateSpace: (
      callback: (scope: {
        context: CanvasRenderingContext2D
        horizontalPixelRatio: number
        verticalPixelRatio: number
        bitmapSize: { width: number; height: number }
      }) => void,
    ) => void
  }) {
    const chart = this.primitive.getChart()
    const series = this.primitive.getSeries()
    if (!chart || !series) return

    const segments = this.primitive.getSegments()
    const lines = this.primitive.getLines()
    if (segments.length === 0 && lines.length === 0) return

    const timeScale = chart.timeScale()

    target.useBitmapCoordinateSpace(
      ({ context, horizontalPixelRatio, verticalPixelRatio, bitmapSize }) => {
        const paneHeight = bitmapSize.height

        for (const segment of segments) {
          const x1 = timeToCoordinateNearest(timeScale, segment.fromTime)
          const x2 = timeToCoordinateNearest(timeScale, segment.toTime)
          if (x1 === null || x2 === null) continue

          const left = Math.round(Math.min(x1, x2) * horizontalPixelRatio)
          const right = Math.round(Math.max(x1, x2) * horizontalPixelRatio)
          const width = Math.max(1, right - left)

          context.save()
          context.fillStyle =
            segment.trend === 'long' ? LONG_TREND_FILL : SHORT_TREND_FILL
          context.fillRect(left, 0, width, paneHeight)
          context.restore()
        }

        for (const line of lines) {
          const x1 = timeToCoordinateNearest(timeScale, line.fromTime)
          const x2 = timeToCoordinateNearest(timeScale, line.toTime)
          const y = series.priceToCoordinate(line.price)
          if (x1 === null || x2 === null || typeof y !== 'number' || !Number.isFinite(y)) {
            continue
          }

          const px1 = Math.round(x1 * horizontalPixelRatio)
          const px2 = Math.round(x2 * horizontalPixelRatio)
          const py = Math.round(y * verticalPixelRatio)
          const stroke =
            line.direction === 'bullish' ? BULLISH_BOS_COLOR : BEARISH_BOS_COLOR

          context.save()
          context.strokeStyle = stroke
          context.lineWidth = Math.max(1, Math.round(horizontalPixelRatio))
          context.setLineDash([4 * horizontalPixelRatio, 3 * horizontalPixelRatio])
          context.beginPath()
          context.moveTo(px1, py)
          context.lineTo(px2, py)
          context.stroke()
          context.restore()
        }
      },
    )
  }
}

class BosOverlayPaneView implements IPrimitivePaneView {
  private readonly primitive: BosOverlayPrimitive

  constructor(primitive: BosOverlayPrimitive) {
    this.primitive = primitive
  }

  renderer() {
    return new BosOverlayPaneRenderer(this.primitive)
  }
}

export class BosOverlayPrimitive implements ISeriesPrimitive<Time> {
  private lines: BosLine[] = []
  private segments: TrendSegment[] = []
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: () => void = () => {}

  constructor(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    analysis: BosAnalysis = {
      lines: [],
      segments: [],
      trendAtOpen: [],
      bosFlipAt: [],
      trendForNextOpen: 'long',
    },
  ) {
    this.chart = chart
    this.series = series
    this.lines = analysis.lines
    this.segments = analysis.segments
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
    return [new BosOverlayPaneView(this)]
  }

  getChart() {
    return this.chart
  }

  getSeries() {
    return this.series
  }

  getLines() {
    return this.lines
  }

  getSegments() {
    return this.segments
  }

  setAnalysis(analysis: BosAnalysis) {
    this.lines = analysis.lines
    this.segments = analysis.segments
    this.requestUpdate()
  }
}
