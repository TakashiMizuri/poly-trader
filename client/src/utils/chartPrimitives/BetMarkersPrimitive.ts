import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { TrendBet } from '@/utils/chart/simulateTrendBetStrategy'
import { timeToCoordinateNearest } from '@/utils/chartPrimitives/timeScaleCoordinate'

const WIN_COLOR = '#3dd6c6'
const LOSS_COLOR = '#f07178'
const LABEL_OFFSET_PX = 10

class BetMarkersPaneRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: BetMarkersPrimitive

  constructor(primitive: BetMarkersPrimitive) {
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
    const bets = this.primitive.getBets()
    if (bets.length === 0) return

    const chart = this.primitive.getChart()
    const series = this.primitive.getSeries()
    if (!chart || !series) return

    const timeScale = chart.timeScale()

    target.useBitmapCoordinateSpace(
      ({ context, horizontalPixelRatio, verticalPixelRatio }) => {
        const fontSize = Math.max(
          9,
          Math.round(11 * Math.min(horizontalPixelRatio, verticalPixelRatio)),
        )
        context.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'

        for (const bet of bets) {
          const x = timeToCoordinateNearest(timeScale, bet.time)
          const anchorPrice = bet.trend === 'long' ? bet.low : bet.high
          const y = series.priceToCoordinate(anchorPrice)
          if (x === null || typeof y !== 'number' || !Number.isFinite(y)) continue

          const px = Math.round(x * horizontalPixelRatio)
          const py = Math.round(
            (bet.trend === 'long' ? y + LABEL_OFFSET_PX : y - LABEL_OFFSET_PX) *
              verticalPixelRatio,
          )

          context.fillStyle = bet.won ? WIN_COLOR : LOSS_COLOR
          context.fillText(bet.won ? '+' : '-', px, py)
        }
      },
    )
  }
}

class BetMarkersPaneView implements IPrimitivePaneView {
  private readonly primitive: BetMarkersPrimitive

  constructor(primitive: BetMarkersPrimitive) {
    this.primitive = primitive
  }

  renderer() {
    return new BetMarkersPaneRenderer(this.primitive)
  }
}

export class BetMarkersPrimitive implements ISeriesPrimitive<Time> {
  private bets: TrendBet[] = []
  private chart: IChartApi | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: () => void = () => {}

  constructor(
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    bets: TrendBet[] = [],
  ) {
    this.chart = chart
    this.series = series
    this.bets = bets
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
    return [new BetMarkersPaneView(this)]
  }

  getChart() {
    return this.chart
  }

  getSeries() {
    return this.series
  }

  getBets() {
    return this.bets
  }

  setBets(bets: TrendBet[]) {
    this.bets = bets
    this.requestUpdate()
  }
}
