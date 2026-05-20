import type { MutableRefObject } from 'react'
import type { IChartApi, ITimeScaleApi, Time } from 'lightweight-charts'

export const STANDARD_TIME_AXIS_RIGHT_OFFSET = 12
export const RIGHT_MARGIN_PIXELS = 48

export function captureTimeScaleScroll(chart: IChartApi | null): number | null {
  if (!chart) return null
  const sp = chart.timeScale().scrollPosition()
  return typeof sp === 'number' && Number.isFinite(sp) ? sp : null
}

export function resolveScrollToRestore(
  isFirstPopulation: boolean,
  savedScroll: number | null,
  lastTrackedScroll: number | null,
): number | null {
  if (isFirstPopulation) return null
  if (savedScroll !== null && Number.isFinite(savedScroll)) return savedScroll
  if (lastTrackedScroll !== null && Number.isFinite(lastTrackedScroll)) {
    return lastTrackedScroll
  }
  return null
}

export function applyTimeScaleBaseOptions(ts: ITimeScaleApi<Time>): void {
  ts.applyOptions({
    rightOffset: STANDARD_TIME_AXIS_RIGHT_OFFSET,
    fixRightEdge: false,
  })
}

export function applyInitialTimeScaleWindow(
  tscale: ITimeScaleApi<Time>,
  seriesLogicalLength: number,
  initialVisibleBarCount: number,
): void {
  if (seriesLogicalLength > 0) {
    const span = Math.min(initialVisibleBarCount, seriesLogicalLength)
    const to = seriesLogicalLength - 1
    const from = Math.max(0, to - span + 1)
    tscale.setVisibleLogicalRange({ from, to })
  }
  tscale.applyOptions({
    rightOffset: STANDARD_TIME_AXIS_RIGHT_OFFSET,
    rightOffsetPixels: RIGHT_MARGIN_PIXELS,
    fixRightEdge: false,
  })
}

export function restoreTimeScaleScroll(
  tscale: ITimeScaleApi<Time>,
  chartRef: MutableRefObject<IChartApi | null>,
  scrollToRestore: number,
  onScrollSampled: (scroll: number) => void,
): void {
  tscale.scrollToPosition(scrollToRestore, false)
  queueMicrotask(() => {
    if (!chartRef.current) return
    const ts = chartRef.current.timeScale()
    ts.scrollToPosition(scrollToRestore, false)
    const sp = ts.scrollPosition()
    if (typeof sp === 'number' && Number.isFinite(sp)) {
      onScrollSampled(sp)
    }
  })
}

export function sampleScrollIntoRef(
  tscale: ITimeScaleApi<Time>,
  setScroll: (v: number) => void,
): void {
  const sp = tscale.scrollPosition()
  if (typeof sp === 'number' && Number.isFinite(sp)) {
    setScroll(sp)
  }
}
