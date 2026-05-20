/** EMA, RSI, swing fractals (1:1 with trading-cursor-models strategies/lib/structure.py). */

export function confirmSwingHigh(
  highs: number[],
  i: number,
  left: number,
  right: number,
): boolean {
  if (i < left || i + right >= highs.length) return false
  const pivot = highs[i]
  for (let j = i - left; j <= i + right; j++) {
    if (j !== i && highs[j] >= pivot) return false
  }
  return true
}

export function confirmSwingLow(
  lows: number[],
  i: number,
  left: number,
  right: number,
): boolean {
  if (i < left || i + right >= lows.length) return false
  const pivot = lows[i]
  for (let j = i - left; j <= i + right; j++) {
    if (j !== i && lows[j] <= pivot) return false
  }
  return true
}

export function ema(values: number[], period: number): (number | null)[] {
  const n = values.length
  const out: (number | null)[] = Array(n).fill(null)
  if (period <= 0 || n < period) return out
  const k = 2 / (period + 1)
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  seed /= period
  out[period - 1] = seed
  let prev = seed
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rsi(closes: number[], period: number): (number | null)[] {
  const n = closes.length
  const out: (number | null)[] = Array(n).fill(null)
  if (period <= 0 || n <= period) return out

  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d
    else losses -= d
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  if (avgLoss === 0) out[period] = 100
  else {
    const rs = avgGain / avgLoss
    out[period] = 100 - 100 / (1 + rs)
  }

  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    if (avgLoss === 0) out[i] = 100
    else {
      const rs = avgGain / avgLoss
      out[i] = 100 - 100 / (1 + rs)
    }
  }
  return out
}
