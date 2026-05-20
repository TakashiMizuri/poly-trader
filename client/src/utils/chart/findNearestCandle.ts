import type { ChartCandle } from '@/types/candle'

export function findNearestCandleByTimestamp(
  candles: ChartCandle[],
  timestamp: number,
): ChartCandle | null {
  if (candles.length === 0) return null
  let left = 0
  let right = candles.length - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midTime = candles[mid].time
    if (midTime === timestamp) return candles[mid]
    if (midTime < timestamp) left = mid + 1
    else right = mid - 1
  }
  const rightCandle = right >= 0 ? candles[right] : null
  const leftCandle = left < candles.length ? candles[left] : null
  if (!leftCandle) return rightCandle
  if (!rightCandle) return leftCandle
  return Math.abs(leftCandle.time - timestamp) < Math.abs(rightCandle.time - timestamp)
    ? leftCandle
    : rightCandle
}
