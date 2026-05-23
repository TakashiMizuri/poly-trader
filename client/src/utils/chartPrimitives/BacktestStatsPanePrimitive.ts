import type {
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  PaneAttachedParameter,
  Time,
} from 'lightweight-charts'
import { getChartPalette } from '@/lib/chartTheme'

export interface BacktestStatsData {
  maxDrawdown: number
  maxDrawdownPct: number
  winRate: number
  netPnl: number
  totalBets: number
}

const PANEL_X = 10
const PANEL_Y = 10
const PANEL_PAD_X = 10
const PANEL_PAD_Y = 8
const ROW_GAP = 5
const FONT_SIZE = 11
const LABEL_COL_WIDTH = 52

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(value).toFixed(2)}`
}

interface StatsRow {
  label: string
  value: string
  valueColor?: 'pnl'
}

function buildRows(stats: BacktestStatsData): StatsRow[] {
  return [
    {
      label: 'Max DD',
      value: `$${stats.maxDrawdown.toFixed(0)} (${stats.maxDrawdownPct.toFixed(1)}%)`,
    },
    {
      label: 'WR',
      value: stats.totalBets > 0 ? `${stats.winRate.toFixed(1)}%` : '—',
    },
    {
      label: 'PnL',
      value: formatSignedUsd(stats.netPnl),
      valueColor: 'pnl',
    },
  ]
}

function measurePanel(
  ctx: CanvasRenderingContext2D,
  rows: StatsRow[],
): { width: number; height: number } {
  ctx.font = `600 ${FONT_SIZE}px ui-monospace, monospace`
  let width = LABEL_COL_WIDTH
  for (const row of rows) {
    width = Math.max(
      width,
      LABEL_COL_WIDTH + ctx.measureText(row.value).width,
    )
  }
  const height =
    PANEL_PAD_Y * 2 + rows.length * FONT_SIZE + (rows.length - 1) * ROW_GAP
  return { width: width + PANEL_PAD_X * 2, height }
}

class BacktestStatsPaneRenderer implements IPrimitivePaneRenderer {
  private readonly primitive: BacktestStatsPanePrimitive

  constructor(primitive: BacktestStatsPanePrimitive) {
    this.primitive = primitive
  }

  draw(target: {
    useMediaCoordinateSpace: (
      callback: (scope: {
        context: CanvasRenderingContext2D
        mediaSize: { width: number; height: number }
      }) => void,
    ) => void
  }) {
    const stats = this.primitive.getStats()
    if (!this.primitive.isVisible() || !stats) return

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const palette = getChartPalette()
      context.save()
      context.font = `600 ${FONT_SIZE}px ui-monospace, monospace`

      const rows = buildRows(stats)
      const { width, height } = measurePanel(context, rows)
      const x = PANEL_X
      const y = PANEL_Y
      const radius = 6

      context.beginPath()
      context.roundRect(x, y, width, height, radius)
      context.fillStyle = 'rgba(12, 15, 20, 0.82)'
      context.fill()
      context.strokeStyle = palette.border
      context.lineWidth = 1
      context.stroke()

      let rowY = y + PANEL_PAD_Y + FONT_SIZE * 0.8
      for (const row of rows) {
        context.textAlign = 'left'
        context.textBaseline = 'middle'
        context.fillStyle = palette.text
        context.fillText(row.label, x + PANEL_PAD_X, rowY)

        context.fillStyle =
          row.valueColor === 'pnl'
            ? stats.netPnl >= 0
              ? palette.up
              : palette.down
            : palette.text
        context.fillText(row.value, x + PANEL_PAD_X + LABEL_COL_WIDTH, rowY)

        rowY += FONT_SIZE + ROW_GAP
      }

      context.restore()

      void mediaSize
    })
  }
}

class BacktestStatsPaneView implements IPanePrimitivePaneView {
  private readonly primitive: BacktestStatsPanePrimitive

  constructor(primitive: BacktestStatsPanePrimitive) {
    this.primitive = primitive
  }

  zOrder() {
    return 'top' as const
  }

  renderer() {
    return this.primitive.isVisible() && this.primitive.getStats()
      ? new BacktestStatsPaneRenderer(this.primitive)
      : null
  }
}

export class BacktestStatsPanePrimitive implements IPanePrimitive<Time> {
  private stats: BacktestStatsData | null = null
  private visible = false
  private requestUpdate: () => void = () => {}
  private readonly paneView: BacktestStatsPaneView

  constructor() {
    this.paneView = new BacktestStatsPaneView(this)
  }

  paneViews() {
    return [this.paneView] as const
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this.requestUpdate = param.requestUpdate
  }

  detached(): void {
    this.requestUpdate = () => {}
  }

  isVisible() {
    return this.visible
  }

  getStats() {
    return this.stats
  }

  update(stats: BacktestStatsData | null, visible: boolean) {
    const sameVisible = this.visible === visible
    const sameStats =
      stats === this.stats ||
      (stats != null &&
        this.stats != null &&
        stats.maxDrawdown === this.stats.maxDrawdown &&
        stats.maxDrawdownPct === this.stats.maxDrawdownPct &&
        stats.winRate === this.stats.winRate &&
        stats.netPnl === this.stats.netPnl &&
        stats.totalBets === this.stats.totalBets)
    if (sameVisible && sameStats) return

    this.stats = stats
    this.visible = visible
    this.requestUpdate()
  }
}
