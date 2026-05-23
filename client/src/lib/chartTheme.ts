export interface ChartPalette {
  background: string
  text: string
  grid: string
  border: string
  up: string
  down: string
  equity: string
}

const CSS_VARS: Record<keyof ChartPalette, string> = {
  background: '--color-chart-background',
  text: '--color-chart-text',
  grid: '--color-chart-grid',
  border: '--color-chart-border',
  up: '--color-chart-up',
  down: '--color-chart-down',
  equity: '--color-chart-equity',
}

const FALLBACK: ChartPalette = {
  background: '#0c0f14',
  text: '#8b95a8',
  grid: '#252d3a',
  border: '#252d3a',
  up: '#3dd6c6',
  down: '#f07178',
  equity: '#79c0ff',
}

/** Backtest equity line — drawn behind candles. */
export const CHART_EQUITY_LINE_ALPHA = 0.38

export function chartColorWithAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha))
  const rgbaMatch = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i,
  )
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${a})`
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex.slice(0, 6)
    const r = Number.parseInt(full.slice(0, 2), 16)
    const g = Number.parseInt(full.slice(2, 4), 16)
    const b = Number.parseInt(full.slice(4, 6), 16)
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${a})`
    }
  }
  return color
}

export function chartEquityLineColor(equity: string): string {
  return chartColorWithAlpha(equity, CHART_EQUITY_LINE_ALPHA)
}

export function getChartPalette(): ChartPalette {
  const style = getComputedStyle(document.documentElement)
  const read = (key: keyof ChartPalette) => {
    const value = style.getPropertyValue(CSS_VARS[key]).trim()
    return value || FALLBACK[key]
  }

  return {
    background: read('background'),
    text: read('text'),
    grid: read('grid'),
    border: read('border'),
    up: read('up'),
    down: read('down'),
    equity: read('equity'),
  }
}
