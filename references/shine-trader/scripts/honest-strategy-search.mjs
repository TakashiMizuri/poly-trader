/**
 * Honest-only strategy search: no use of bar[i] high/low/close or bosFlipAt[i].
 */
import fs from 'fs';

const file = process.argv[2] ?? 'tmp_candles.json';
const candles = JSON.parse(fs.readFileSync(file, 'utf8')).data.map((c) => ({
  time: Math.floor(Date.parse(c.timestamp) / 1000),
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
}));

const isBull = (c) => c.close > c.open;
const isBear = (c) => c.close < c.open;

function backtest(predictFn, warmup = 30) {
  let w = 0,
    l = 0,
    s = 0;
  for (let i = warmup; i < candles.length; i++) {
    const pred = predictFn(i);
    if (pred === null) {
      s++;
      continue;
    }
    const c = candles[i];
    if (c.close === c.open) {
      s++;
      continue;
    }
    const win = (pred === 'long') === isBull(c);
    if (win) w++;
    else l++;
  }
  const t = w + l;
  return { w, l, s, t, wr: t ? (w / t) * 100 : 0 };
}

function analyzeTrendAndBos(structureLookback) {
  const lookback = Math.max(1, structureLookback);
  const trendAtOpen = ['long'];
  const bosFlipAt = [false];
  let trend = 'long';
  const refLow = (i) => {
    let ref = Infinity;
    for (let k = Math.max(0, i - lookback); k < i; k++) ref = Math.min(ref, candles[k].low);
    return ref;
  };
  const refHigh = (i) => {
    let ref = -Infinity;
    for (let k = Math.max(0, i - lookback); k < i; k++) ref = Math.max(ref, candles[k].high);
    return ref;
  };
  for (let i = 1; i < candles.length; i++) {
    trendAtOpen.push(trend);
    bosFlipAt.push(false);
    const close = candles[i].close;
    if (trend === 'long' && close < refLow(i)) {
      bosFlipAt[i] = true;
      trend = 'short';
    } else if (trend === 'short' && close > refHigh(i)) {
      bosFlipAt[i] = true;
      trend = 'long';
    }
  }
  return { trendAtOpen, bosFlipAt };
}

function closesUntil(i) {
  return candles.slice(0, i).map((c) => c.close);
}

function rsi(i, period = 14) {
  const cl = closesUntil(i);
  if (cl.length < period + 1) return null;
  let g = 0,
    lo = 0;
  for (let j = cl.length - period; j < cl.length; j++) {
    const d = cl[j] - cl[j - 1];
    if (d > 0) g += d;
    else lo -= d;
  }
  if (lo === 0) return 100;
  return 100 - 100 / (1 + g / lo);
}

function bullishFvg(idx) {
  if (idx < 2) return false;
  return candles[idx].low > candles[idx - 2].high;
}
function bearishFvg(idx) {
  if (idx < 2) return false;
  return candles[idx].high < candles[idx - 2].low;
}

const bos = {};
for (const lb of [1, 3, 5, 8, 13, 21]) bos[lb] = analyzeTrendAndBos(lb);

const strats = [];

// Mean reversion family
for (const lb of [1, 3, 5, 8, 13, 21]) {
  strats.push({
    n: `mean_revert_lb${lb}`,
    fn: (i) => (bos[lb].trendAtOpen[i] === 'long' ? 'short' : 'long'),
  });
}

// FVG fade / follow (on completed bar i-1)
strats.push({
  n: 'bull_fvg_fade',
  fn: (i) => (bullishFvg(i - 1) ? 'short' : null),
});
strats.push({
  n: 'bear_fvg_fade',
  fn: (i) => (bearishFvg(i - 1) ? 'long' : null),
});
strats.push({
  n: 'any_fvg_fade',
  fn: (i) => {
    if (bullishFvg(i - 1)) return 'short';
    if (bearishFvg(i - 1)) return 'long';
    return null;
  },
});

// Gap
strats.push({
  n: 'gap_down_fade',
  fn: (i) => {
    const g = candles[i].open - candles[i - 1].close;
    return g < -0.00003 ? 'long' : null;
  },
});
strats.push({
  n: 'gap_up_fade',
  fn: (i) => {
    const g = candles[i].open - candles[i - 1].close;
    return g > 0.00003 ? 'short' : null;
  },
});

// RSI selective
for (const [lo, hi, side] of [
  [30, 100, 'long'],
  [35, 100, 'long'],
  [0, 25, 'short'],
  [0, 30, 'short'],
  [65, 100, 'short'],
  [70, 100, 'short'],
]) {
  strats.push({
    n: `rsi_${lo}_${hi}_${side}`,
    fn: (i) => {
      const r = rsi(i);
      if (r === null) return null;
      if (r >= lo && r <= hi) return side;
      return null;
    },
  });
}

// Combos
for (const lb of [3, 5, 8]) {
  strats.push({
    n: `mean_rev_lb${lb}_rsi_extreme`,
    fn: (i) => {
      const r = rsi(i);
      if (r === null) return null;
      const rev = bos[lb].trendAtOpen[i] === 'long' ? 'short' : 'long';
      if (rev === 'long' && r < 40) return 'long';
      if (rev === 'short' && r > 60) return 'short';
      return null;
    },
  });
  strats.push({
    n: `mean_rev_lb${lb}_bull_fvg_fade`,
    fn: (i) => {
      const rev = bos[lb].trendAtOpen[i] === 'long' ? 'short' : 'long';
      if (bullishFvg(i - 1) && rev === 'short') return 'short';
      if (bearishFvg(i - 1) && rev === 'long') return 'long';
      return null;
    },
  });
}

// 3-bar exhaustion against trend
strats.push({
  n: 'exhaustion_3bar_vs_trend_lb5',
  fn: (i) => {
    if (i < 3) return null;
    const t = bos[5].trendAtOpen[i];
    const last3 = [i - 1, i - 2, i - 3].every((j) => isBull(candles[j]));
    const last3b = [i - 1, i - 2, i - 3].every((j) => isBear(candles[j]));
    if (t === 'long' && last3) return 'short';
    if (t === 'short' && last3b) return 'long';
    return null;
  },
});

// London open 7-10 UTC fade gap
strats.push({
  n: 'london_gap_fade',
  fn: (i) => {
    const h = new Date(candles[i].time * 1000).getUTCHours();
    if (h < 7 || h > 10) return null;
    const g = candles[i].open - candles[i - 1].close;
    if (g > 0.00005) return 'short';
    if (g < -0.00005) return 'long';
    return null;
  },
});

// Prev bar large body fade
strats.push({
  n: 'large_body_fade',
  fn: (i) => {
    const p = candles[i - 1];
    const body = Math.abs(p.close - p.open);
    const range = p.high - p.low;
    if (range === 0 || body / range < 0.7) return null;
    return isBull(p) ? 'short' : 'long';
  },
});

const results = strats
  .map((s) => ({ ...backtest(s.fn), n: s.n }))
  .filter((r) => r.t >= 150)
  .sort((a, b) => b.wr - a.wr);

console.log('Dataset:', candles.length, 'bars\n');
console.log('Honest strategies (>=150 bets):');
for (const r of results.filter((r) => r.wr > 50).slice(0, 30)) {
  console.log(`${r.wr.toFixed(2)}% | ${r.t} bets | ${r.n}`);
}
console.log('\nAll top 20:');
for (const r of results.slice(0, 20)) {
  console.log(`${r.wr.toFixed(2)}% | ${r.t} bets | ${r.n}`);
}
