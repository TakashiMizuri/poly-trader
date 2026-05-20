/**
 * Backtest: at each bar open, predict bullish (close > open) or bearish (close < open).
 * Only uses data from bars [0..i-1] and bar i open — no lookahead on bar i H/L/C.
 */
import fs from 'fs';

const candlesPath = process.argv[2] ?? 'tmp_candles.json';
const raw = JSON.parse(fs.readFileSync(candlesPath, 'utf8'));
const candles = raw.data.map((c) => ({
  time: Math.floor(Date.parse(c.timestamp) / 1000),
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
}));

function isBull(c) {
  return c.close > c.open;
}
function isBear(c) {
  return c.close < c.open;
}

function runBacktest(name, predictFn, { warmup = 20, skipDoji = true } = {}) {
  let wins = 0;
  let losses = 0;
  let skipped = 0;
  let bullishBets = 0;
  let bearishBets = 0;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i];
    const pred = predictFn(i, candles);
    if (pred === null) {
      skipped++;
      continue;
    }
    if (c.close === c.open) {
      if (skipDoji) {
        skipped++;
        continue;
      }
      losses++;
      continue;
    }
    const actualBull = isBull(c);
    const betBull = pred === 'long';
    if (betBull) bullishBets++;
    else bearishBets++;
    if (betBull === actualBull) wins++;
    else losses++;
  }

  const total = wins + losses;
  return {
    name,
    wins,
    losses,
    skipped,
    total,
    winRate: total > 0 ? (wins / total) * 100 : 0,
    bullishBets,
    bearishBets,
  };
}

// --- BoS / trend (ported from detectBreakOfStructure.ts) ---
function analyzeTrendAndBos(candles, structureLookback = 1) {
  const lookback = Math.max(1, structureLookback);
  const trendAtOpen = [];
  const bosFlipAt = [];
  let trend = 'long';
  trendAtOpen.push(trend);
  bosFlipAt.push(false);

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
    if (trend === 'long') {
      if (close < refLow(i)) {
        bosFlipAt[i] = true;
        trend = 'short';
      }
    } else if (close > refHigh(i)) {
      bosFlipAt[i] = true;
      trend = 'long';
    }
  }
  return { trendAtOpen, bosFlipAt };
}

function sma(closes, period) {
  if (closes.length < period) return null;
  let s = 0;
  for (let i = closes.length - period; i < closes.length; i++) s += closes[i];
  return s / period;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function bullishFvgAt(i, candles) {
  // 3-candle bullish FVG: low[i] > high[i-2], gap unfilled on bar i-1
  if (i < 2) return false;
  return candles[i].low > candles[i - 2].high;
}

function bearishFvgAt(i, candles) {
  if (i < 2) return false;
  return candles[i].high < candles[i - 2].low;
}

const bos1 = analyzeTrendAndBos(candles, 1);
const bos3 = analyzeTrendAndBos(candles, 3);
const bos5 = analyzeTrendAndBos(candles, 5);

const strategies = [];

// Trend follow / fade
for (const lb of [1, 3, 5, 10]) {
  const { trendAtOpen } = lb === 1 ? bos1 : lb === 3 ? bos3 : lb === 5 ? bos5 : analyzeTrendAndBos(candles, lb);
  strategies.push({
    name: `trend_follow_lb${lb}`,
    fn: (i) => trendAtOpen[i],
  });
  strategies.push({
    name: `mean_revert_lb${lb}`,
    fn: (i) => (trendAtOpen[i] === 'long' ? 'short' : 'long'),
  });
}

// Honest: at open of i we only know bosFlipAt[0..i-1]
strategies.push({
  name: 'trend_follow_honest_every_bar_lb1',
  fn: (i) => bos1.trendAtOpen[i],
});
strategies.push({
  name: 'trend_follow_skip_prev_was_bos_lb1',
  fn: (i) => (i > 0 && bos1.bosFlipAt[i - 1] ? null : bos1.trendAtOpen[i]),
});
strategies.push({
  name: 'trend_follow_only_prev_was_bos_lb1',
  fn: (i) => (i > 0 && bos1.bosFlipAt[i - 1] ? bos1.trendAtOpen[i] : null),
});
// Cheating (lookahead): knows bosFlipAt[i] before bar closes
strategies.push({
  name: 'CHEAT_trend_skip_current_bos_bar_lb1',
  fn: (i) => (bos1.bosFlipAt[i] ? null : bos1.trendAtOpen[i]),
});

// Previous candle momentum / reversal
strategies.push({
  name: 'prev_candle_continuation',
  fn: (i) => (isBull(candles[i - 1]) ? 'long' : isBear(candles[i - 1]) ? 'short' : null),
});
strategies.push({
  name: 'prev_candle_reversal',
  fn: (i) => (isBull(candles[i - 1]) ? 'short' : isBear(candles[i - 1]) ? 'short' : null),
});
strategies.push({
  name: 'prev2_bull_streak_continuation',
  fn: (i) => {
    if (i < 2) return null;
    if (isBull(candles[i - 1]) && isBull(candles[i - 2])) return 'long';
    if (isBear(candles[i - 1]) && isBear(candles[i - 2])) return 'short';
    return null;
  },
});

// Gap at open vs prev close
strategies.push({
  name: 'gap_up_fade',
  fn: (i) => {
    const gap = candles[i].open - candles[i - 1].close;
    if (gap > 0.00002) return 'short';
    return null;
  },
});
strategies.push({
  name: 'gap_down_fade',
  fn: (i) => {
    const gap = candles[i].open - candles[i - 1].close;
    if (gap < -0.00002) return 'long';
    return null;
  },
});
strategies.push({
  name: 'gap_follow',
  fn: (i) => {
    const gap = candles[i].open - candles[i - 1].close;
    if (gap > 0.00002) return 'long';
    if (gap < -0.00002) return 'short';
    return null;
  },
});

// FVG on completed bars only (detect on i-1 using i-3,i-2,i-1)
strategies.push({
  name: 'bullish_fvg_continuation',
  fn: (i) => (bullishFvgAt(i - 1, candles) ? 'long' : null),
});
strategies.push({
  name: 'bearish_fvg_continuation',
  fn: (i) => (bearishFvgAt(i - 1, candles) ? 'short' : null),
});
strategies.push({
  name: 'bullish_fvg_fade',
  fn: (i) => (bullishFvgAt(i - 1, candles) ? 'short' : null),
});
strategies.push({
  name: 'any_fvg_trend',
  fn: (i) => {
    if (bullishFvgAt(i - 1, candles)) return 'long';
    if (bearishFvgAt(i - 1, candles)) return 'short';
    return null;
  },
});

// RSI
for (const thresh of [30, 35, 40, 45]) {
  strategies.push({
    name: `rsi_lt_${thresh}_long`,
    fn: (i) => {
      const closes = candles.slice(0, i).map((c) => c.close);
      const r = rsi(closes, 14);
      if (r === null || r >= thresh) return null;
      return 'long';
    },
  });
  strategies.push({
    name: `rsi_gt_${100 - thresh}_short`,
    fn: (i) => {
      const closes = candles.slice(0, i).map((c) => c.close);
      const r = rsi(closes, 14);
      if (r === null || r <= 100 - thresh) return null;
      return 'short';
    },
  });
}

// SMA
for (const p of [8, 20, 50]) {
  strategies.push({
    name: `close_above_sma${p}_long`,
    fn: (i) => {
      const closes = candles.slice(0, i).map((c) => c.close);
      const m = sma(closes, p);
      if (m === null) return null;
      const lastClose = closes[closes.length - 1];
      return lastClose > m ? 'long' : 'short';
    },
  });
}

// Inside bar breakout (mother bar i-2, inside i-1)
strategies.push({
  name: 'inside_bar_break_prev_high',
  fn: (i) => {
    if (i < 2) return null;
    const mother = candles[i - 2];
    const inside = candles[i - 1];
    if (inside.high < mother.high && inside.low > mother.low) {
      return candles[i].open > inside.high ? 'long' : candles[i].open < inside.low ? 'short' : null;
    }
    return null;
  },
});

// Hour-of-day (UTC from timestamp)
const hourBullRate = Array(24).fill(0).map(() => ({ bull: 0, total: 0 }));
for (let i = 0; i < candles.length; i++) {
  const h = new Date(candles[i].time * 1000).getUTCHours();
  hourBullRate[h].total++;
  if (isBull(candles[i])) hourBullRate[h].bull++;
}
for (let h = 0; h < 24; h++) {
  if (hourBullRate[h].total < 50) continue;
  const rate = hourBullRate[h].bull / hourBullRate[h].total;
  if (rate > 0.52) {
    strategies.push({
      name: `hour_${h}_utc_long`,
      fn: (i) => (new Date(candles[i].time * 1000).getUTCHours() === h ? 'long' : null),
    });
  }
  if (rate < 0.48) {
    strategies.push({
      name: `hour_${h}_utc_short`,
      fn: (i) => (new Date(candles[i].time * 1000).getUTCHours() === h ? 'short' : null),
    });
  }
}

// Combined: trend + RSI filter
strategies.push({
  name: 'trend_lb3_rsi_confirm',
  fn: (i) => {
    const trend = bos3.trendAtOpen[i];
    const closes = candles.slice(0, i).map((c) => c.close);
    const r = rsi(closes, 14);
    if (r === null) return null;
    if (trend === 'long' && r < 55) return 'long';
    if (trend === 'short' && r > 45) return 'short';
    return null;
  },
});

// Engulfing on prev bar
strategies.push({
  name: 'bullish_engulf_long',
  fn: (i) => {
    if (i < 2) return null;
    const prev = candles[i - 1];
    const pp = candles[i - 2];
    if (isBear(pp) && isBull(prev) && prev.open <= pp.close && prev.close >= pp.open) return 'long';
    return null;
  },
});
strategies.push({
  name: 'bearish_engulf_short',
  fn: (i) => {
    if (i < 2) return null;
    const prev = candles[i - 1];
    const pp = candles[i - 2];
    if (isBull(pp) && isBear(prev) && prev.open >= pp.close && prev.close <= pp.open) return 'short';
    return null;
  },
});

// Higher timeframe proxy: last 12 bars (1h on 5m) trend
strategies.push({
  name: 'htf_12bar_trend_follow',
  fn: (i) => {
    if (i < 12) return null;
    const start = candles[i - 12].close;
    const end = candles[i - 1].close;
    return end > start ? 'long' : 'short';
  },
});

// Always bet (baseline)
strategies.push({ name: 'always_long', fn: () => 'long' });
strategies.push({ name: 'always_short', fn: () => 'short' });

const results = strategies
  .map((s) => runBacktest(s.name, s.fn))
  .filter((r) => r.total >= 100)
  .sort((a, b) => b.winRate - a.winRate);

console.log(`Candles: ${candles.length}\n`);
console.log('Top 25 strategies (min 100 bets):');
console.log('winRate% | bets | name');
for (const r of results.slice(0, 25)) {
  console.log(
    `${r.winRate.toFixed(2).padStart(6)} | ${String(r.total).padStart(5)} | ${r.name}`,
  );
}

const above50 = results.filter((r) => r.winRate > 50);
console.log(`\nStrategies with winRate > 50%: ${above50.length}`);

// Grid: trend + skip bos + hour
console.log('\n--- Refined combos ---');
const combos = [];
for (const lb of [1, 3, 5, 8, 13]) {
  const { trendAtOpen, bosFlipAt } = analyzeTrendAndBos(candles, lb);
  for (const skipPrevBos of [true, false]) {
    for (const minStreak of [0, 2, 3]) {
      combos.push({
        name: `honest_combo_lb${lb}_skipPrevBos${skipPrevBos}_streak${minStreak}`,
        fn: (i) => {
          if (skipPrevBos && i > 0 && bosFlipAt[i - 1]) return null;
          let streak = 0;
          for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
            const bull = isBull(candles[j]);
            if (trendAtOpen[i] === 'long' && bull) streak++;
            else if (trendAtOpen[i] === 'short' && isBear(candles[j])) streak++;
            else break;
          }
          if (streak < minStreak) return null;
          return trendAtOpen[i];
        },
      });
    }
  }
}

const comboResults = combos
  .map((s) => runBacktest(s.name, s.fn))
  .filter((r) => r.total >= 200)
  .sort((a, b) => b.winRate - a.winRate);
for (const r of comboResults.slice(0, 15)) {
  console.log(`${r.winRate.toFixed(2).padStart(6)} | ${String(r.total).padStart(5)} | ${r.name}`);
}
