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
