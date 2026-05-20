import type { Coordinate, ITimeScaleApi, Logical, Time } from 'lightweight-charts'

export function timeToCoordinateNearest(
  timeScale: ITimeScaleApi<Time>,
  unixSeconds: number,
): Coordinate | null {
  const t = unixSeconds as Time
  const exact = timeScale.timeToCoordinate(t)
  if (exact !== null) return exact
  const idx = timeScale.timeToIndex(t, true)
  if (idx === null) return null
  return timeScale.logicalToCoordinate(idx as unknown as Logical)
}
