import fs from 'fs'

const cfg = {
  lookback: 48,
  lookbackFast: 18,
  zThreshold: 1.08,
  minRangePct: 0.0026,
  zReversal: false,
  zFastMin: 0.6,
  rankConfirm: 0,
  zMax: 0,
  sessionUtcStart: null,
  sessionUtcEnd: null,
}

function sessionOk(openTimeUnix) {
  const { sessionUtcStart: start, sessionUtcEnd: end } = cfg
  if (start === null || end === null) return true
  const hour = Math.floor((openTimeUnix / 3600) % 24)
  if (start <= end) return hour >= start && hour < end
  return hour >= start || hour < end
}

function zScore(values, endIdx, lookback) {
  const start = endIdx - lookback
  if (start < 0) return null
  let sum = 0
  for (let i = start; i < endIdx; i++) sum += values[i]
  const mu = sum / lookback
  let varSum = 0
  for (let i = start; i < endIdx; i++) {
    const d = values[i] - mu
    varSum += d * d
  }
  const std = Math.sqrt(varSum / lookback)
  if (std <= 0) return null
  return (values[endIdx] - mu) / std
}

function generateBlendFade2Signals(candles) {
  const n = candles.length
  const entryBar = Array(n).fill(false)
  const side = Array(n).fill(null)
  const closes = candles.map((c) => c.close)
  const openTimes = candles.map((c) => c.time)
  const lb = cfg.lookback
  const lbF = cfg.lookbackFast
  const zTh = cfg.zThreshold

  for (let i = 1; i < n; i++) {
    if (!sessionOk(openTimes[i])) continue
    const closed = i - 1
    if (closed < Math.max(lb, lbF) + 1) continue
    const z = zScore(closes, closed, lb)
    if (z === null) continue
    if (cfg.minRangePct > 0 && closed >= lb) {
      const windowStart = closed - lb
      const ref = closes[windowStart]
      if (ref > 0) {
        let windowMax = closes[windowStart]
        let windowMin = closes[windowStart]
        for (let j = windowStart; j <= closed; j++) {
          windowMax = Math.max(windowMax, closes[j])
          windowMin = Math.min(windowMin, closes[j])
        }
        if ((windowMax - windowMin) / ref < cfg.minRangePct) continue
      }
    }
    let signalSide = null
    if (z > zTh) signalSide = 'short'
    else if (z < -zTh) signalSide = 'long'
    if (signalSide === null) continue
    if (cfg.zFastMin > 0) {
      const zFast = zScore(closes, closed, lbF)
      if (zFast === null) continue
      if (signalSide === 'short' && zFast < cfg.zFastMin) continue
      if (signalSide === 'long' && zFast > -cfg.zFastMin) continue
    }
    entryBar[i] = true
    side[i] = signalSide
  }
  return { entryBar, side }
}

function processCandleClose(closedCandle, closedCandles, intervalSec) {
  let closedIndexInInput = -1
  for (let i = closedCandles.length - 1; i >= 0; i--) {
    if (closedCandles[i].time === closedCandle.time) {
      closedIndexInInput = i
      break
    }
  }
  if (closedIndexInInput < 0) return null
  const window = closedCandles.slice(0, closedIndexInInput + 1)
  const closedIndex = window.length - 1
  if (window[closedIndex]?.time !== closedCandle.time) return null

  const signals = generateBlendFade2Signals(window)
  const betAtOpen = signals.entryBar[closedIndex] ? signals.side[closedIndex] : null

  let entry = null
  if (intervalSec > 0) {
    const nextOpenTime = closedCandle.time + intervalSec
    const anchor = window[window.length - 1]
    const nextFromFeed = closedCandles.find((c) => c.time === nextOpenTime)
    const extended = [
      ...window,
      nextFromFeed ?? {
        time: nextOpenTime,
        open: anchor.close,
        high: anchor.close,
        low: anchor.close,
        close: anchor.close,
      },
    ]
    const nextIndex = window.length
    const extSignals = generateBlendFade2Signals(extended)
    if (extSignals.entryBar[nextIndex]) {
      entry = { target: nextOpenTime, trend: extSignals.side[nextIndex] }
    }
  }
  return { betAtOpen, entry }
}

const rows = JSON.parse(fs.readFileSync('tmp_binance_100.json', 'utf8'))
const candles = rows.map((r) => ({
  time: r[0] / 1000,
  open: +r[1],
  high: +r[2],
  low: +r[3],
  close: +r[4],
}))

const TARGET = 1779463200
const idx = candles.findIndex((c) => c.time === TARGET)
console.log('candles', candles.length, 'target idx', idx)
if (idx >= 0) {
  const sig = generateBlendFade2Signals(candles)
  console.log('entryBar@target', sig.entryBar[idx], 'side', sig.side[idx])
}

// simulate close at 1779462900 -> entry for 1779463200
const closed2900 = candles.find((c) => c.time === 1779462900)
const buf2900 = candles.filter((c) => c.time <= 1779462900)
const buf2900Full = candles // engine may have forming bar in full buffer
if (closed2900) {
  console.log('processClose(1779462900) trimmed', JSON.stringify(processCandleClose(closed2900, buf2900, 300)))
  console.log('processClose(1779462900) full+forming', JSON.stringify(processCandleClose(closed2900, buf2900Full, 300)))
}

const closed3200 = candles.find((c) => c.time === 1779463200)
const buf3200 = candles.filter((c) => c.time <= 1779463200)
if (closed3200) {
  const r = processCandleClose(closed3200, buf3200, 300)
  console.log('processClose(1779463200)', JSON.stringify(r))
  const sig = generateBlendFade2Signals(buf3200)
  console.log('settlement@3200', sig.entryBar[sig.entryBar.length - 1], sig.side[sig.side.length - 1])
}

// z-score debug at 15:15 close (index for 1779462900)
const idx915 = candles.findIndex((c) => c.time === 1779462900)
if (idx915 >= 0) {
  const closes = candles.map((c) => c.close)
  const closed = idx915
  const z = zScore(closes, closed, cfg.lookback)
  const zFast = zScore(closes, closed, cfg.lookbackFast)
  console.log('z@15:15 close', z, 'zFast', zFast, 'close', closes[closed])
}

// shorter buffer (WS gap scenario)
for (const take of [60, 80, 95, 99]) {
  const sub = candles.slice(-take)
  const c15 = sub.find((c) => c.time === 1779462900)
  if (!c15) continue
  const r = processCandleClose(c15, sub, 300)
  if (r?.entry?.target === 1779463200) {
    console.log('ENTRY@15:20 with last', take, 'candles')
  }
}

// last 5 entry bars
const sigAll = generateBlendFade2Signals(candles)
for (let i = 0; i < candles.length; i++) {
  if (sigAll.entryBar[i]) {
    console.log('ENTRY', new Date(candles[i].time * 1000).toISOString(), sigAll.side[i])
  }
}
