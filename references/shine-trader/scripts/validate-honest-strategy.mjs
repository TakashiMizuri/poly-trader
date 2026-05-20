import fs from 'fs';
import { createRequire } from 'module';

const strategies = {
  mean_revert_lb5: (ctx, i) => (ctx.trend5[i] === 'long' ? 'short' : 'long'),
  exhaustion_3bar_lb5: (ctx, i) => {
    if (i < 3) return null;
    const t = ctx.trend5[i];
    const b3 = [i - 1, i - 2, i - 3].every((j) => ctx.candles[j].close > ctx.candles[j].open);
    const s3 = [i - 1, i - 2, i - 3].every((j) => ctx.candles[j].close < ctx.candles[j].open);
    if (t === 'long' && b3) return 'short';
    if (t === 'short' && s3) return 'long';
    return null;
  },
  mean_rev_fvg_lb5: (ctx, i) => {
    const rev = ctx.trend5[i] === 'long' ? 'short' : 'long';
    const bullFvg = ctx.candles[i - 1].low > ctx.candles[i - 3].high;
    const bearFvg = ctx.candles[i - 1].high < ctx.candles[i - 3].low;
    if (bullFvg && rev === 'short') return 'short';
    if (bearFvg && rev === 'long') return 'long';
    return null;
  },
  large_body_fade: (ctx, i) => {
    const p = ctx.candles[i - 1];
    const body = Math.abs(p.close - p.open);
    const range = p.high - p.low;
    if (range === 0 || body / range < 0.7) return null;
    return p.close > p.open ? 'short' : 'long';
  },
  /** Union: first matching sub-signal (priority order) */
  ensemble_priority: (ctx, i) => {
    for (const fn of [
      strategies.exhaustion_3bar_lb5,
      strategies.mean_rev_fvg_lb5,
      strategies.large_body_fade,
    ]) {
      const p = fn(ctx, i);
      if (p) return p;
    }
    return strategies.mean_revert_lb5(ctx, i);
  },
};

function buildContext(candles) {
  const trend5 = ['long'];
  let trend = 'long';
  const lb = 5;
  const refLow = (i) => {
    let r = Infinity;
    for (let k = Math.max(0, i - lb); k < i; k++) r = Math.min(r, candles[k].low);
    return r;
  };
  const refHigh = (i) => {
    let r = -Infinity;
    for (let k = Math.max(0, i - lb); k < i; k++) r = Math.max(r, candles[k].high);
    return r;
  };
  for (let i = 1; i < candles.length; i++) {
    trend5.push(trend);
    const close = candles[i].close;
    if (trend === 'long' && close < refLow(i)) trend = 'short';
    else if (trend === 'short' && close > refHigh(i)) trend = 'long';
  }
  return { candles, trend5 };
}

function load(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8')).data.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    time: c.timestamp,
  }));
}

function test(name, fn, candles) {
  const ctx = buildContext(candles);
  let w = 0,
    l = 0,
    s = 0;
  for (let i = 30; i < candles.length; i++) {
    const pred = fn(ctx, i);
    if (!pred) {
      s++;
      continue;
    }
    const c = candles[i];
    if (c.close === c.open) {
      s++;
      continue;
    }
    const bull = c.close > c.open;
    if ((pred === 'long') === bull) w++;
    else l++;
  }
  const t = w + l;
  return { name, w, l, s, t, wr: t ? (w / t) * 100 : 0 };
}

const files = process.argv.slice(2);
if (files.length === 0) files.push('tmp_candles.json');

for (const f of files) {
  const candles = load(f);
  console.log(`\n=== ${f} (${candles.length} bars) ===`);
  for (const [name, fn] of Object.entries(strategies)) {
    const r = test(name, fn, candles);
    console.log(`${r.wr.toFixed(2)}% win | ${r.t} bets | skip ${r.s} | ${name}`);
  }
}
