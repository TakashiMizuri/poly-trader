# Candle-Direction Auto-Trading — Full Specification

> **Purpose:** Single source of truth for a **separate** automated trading project: **exhaustion fade** on 5m candles, causal BoS, **1% compound** position sizing (**no stake cap**), execution on BTC perps (Lighter / Ostium).
>
> **Last updated:** 2026-05-19  
> **Primary research data:** BTCUSDT 5m, Binance (~105,120 bars, May 2025 → May 2026)  
> **Not financial advice.** Backtests assume ideal fills and 0% fees unless stated.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Trading hypothesis](#2-trading-hypothesis)
3. [Data and causality rules](#3-data-and-causality-rules)
4. [Strategy — Exhaustion fade (only)](#4-strategy--exhaustion-fade-only)
5. [BoS trend engine](#5-bos-trend-engine)
6. [Backtest results (BTC, default params)](#6-backtest-results-btc-default-params)
7. [Position sizing — 1% compound, no cap](#7-position-sizing--1-compound-no-cap)
8. [Fee models and venues](#8-fee-models-and-venues)
9. [Live trading pipeline](#9-live-trading-pipeline)
10. [TP/SL, leverage, liquidation](#10-tpsl-leverage-liquidation)
11. [Reference implementation (shine-trader)](#11-reference-implementation-shine-trader)
12. [Scripts and reproduction](#12-scripts-and-reproduction)
13. [New project blueprint](#13-new-project-blueprint)
14. [Configuration reference](#14-configuration-reference)
15. [Risks and limitations](#15-risks-and-limitations)
16. [Appendices](#16-appendices)

---

## 1. Executive summary

### 1.1 What we trade

At each **5m bar open**, optionally open a **BTC perp** position predicting whether that candle will close **bullish** (`close > open`) or **bearish** (`close < open`). Close the position at the **next** 5m boundary (~5 minutes later).

### 1.2 The only strategy in scope

**Exhaustion fade** — fade the BoS trend after **N** consecutive same-color **closed** bars aligned with that trend.

| Item | Value |
|------|--------|
| **Default params** | `exhaustionConsecutiveBars = 3`, `structureLookback = 5` |
| **Position size** | **1% of current balance**, every trade (**compound**) |
| **Stake cap** | **None** (no `maxStake`) |
| **Leverage (live)** | **1×** recommended |
| **Fees (planning)** | **Lighter Standard 0%** or **Ostium ~5 bps open** @ 1× |

**Removed / out of scope:** mean reversion every bar, trend-following, Polymarket as primary venue, 5% compound as default sizing.

### 1.3 BTC year snapshot (default params, 1% compound, 0% fees)

| Metric | Value |
|--------|--------|
| Period | 2025-05-19 → 2026-05-19 |
| Start balance | $100 |
| **End balance** | **$8,323,401** |
| Win rate | **53.14%** (19,619 bets) |
| Min balance | **$97.03** |
| Max consecutive losses | **15** |

Dollar totals are **simulator output** (binary ±stake, compound 1%). Use for **relative** planning; live PnL follows BTC % move on perp plus fees/slippage.

### 1.4 Do not use (invalid live)

- `bosFlipAt[i]` at the **open** of bar `i` (lookahead; inflates WR to ~61%).
- Mean reversion on every bar for this bot (high frequency, large drawdowns with larger % stake).
- Polymarket **taker** for ~20k trades/year.
- Ostium **$0.10 oracle per round trip** without confirming refund — kills high-frequency variants in stress tests.

---

## 2. Trading hypothesis

### 2.1 Prediction at bar open

- **Long:** expect `close[i] > open[i]`
- **Short:** expect `close[i] < open[i]`
- **Doji** (`close == open`): skip (no bet)

### 2.2 Forbidden at decision time (bar `i` open)

- `high[i]`, `low[i]`, `close[i]`
- `bosFlipAt[i]` (confirmed only when bar `i` **closes**)

### 2.3 Allowed

- OHLC of bars `0 .. i-1`
- `trendAtOpen[i]` from BoS (state before bar `i` closes)
- For exhaustion: colors of bars `i-N .. i-1` only

### 2.4 Win definition (backtest)

```
win = (bet == 'long'  AND close > open)
   OR (bet == 'short' AND close < open)
pnl = win ? +stake - fees : -stake - fees
```

Live perp PnL = f(entry/exit prices, fees, funding), not exactly this binary model.

---

## 3. Data and causality rules

### 3.1 Primary dataset

- **Symbol:** BTCUSDT  
- **Interval:** 5m  
- **Source:** Binance `GET /api/v3/klines`  
- **Cache file:** `tmp_btc_5m_year.json` (~105,120 bars)

### 3.2 `trendAtOpen[i]` is causal

`analyzeTrendAndBos` appends `trend` to `trendAtOpen` **before** applying bar `i`'s close to flip logic. So `trendAtOpen[i]` uses only bars `< i`.

### 3.3 Exhaustion uses only closed bars

At open of bar `i`, check bars `i-1`, `i-2`, …, `i-N` for same-color streak.

---

## 4. Strategy — Exhaustion fade (only)

### 4.1 Logic

```
trend = trendAtOpen[i]
last N closed bars all bullish  (close > open)  → if trend == 'long'  → bet SHORT
last N closed bars all bearish  (close < open)  → if trend == 'short' → bet LONG
else → no bet
```

### 4.2 Default parameters (canonical for this spec)

| Parameter | Default | Range (UI) | Notes |
|-----------|---------|------------|--------|
| `exhaustionConsecutiveBars` | **3** | 2–20 | **N** in logic above |
| `structureLookback` | **5** | 1–50 | BoS swing lookback **LB** |
| `bosMinSegmentBars` | 0 | 0–100 | Min bars in leg before flip |
| `bosMinBarsBetweenFlips` | 0 | 0–100 | Cooldown between BoS flips |
| `bosBreakBuffer` | 0 | 0+ | Extra break (USD on BTC) |
| `bosBodyBreakOnly` | false | bool | Body vs wick break |
| `minBarsSinceFlip` | 0 | 0–500 | 0 = off; entry timing filter |
| `maxBarsSinceFlip` | 0 | 0–500 | 0 = off |
| `minDistanceFromStructure` | 0 | 0+ | Min open-to-level distance (USD) |

**Production default for autotrader:** only **N=3**, **LB=5**; other fields **0/false** unless you run a new backtest sweep.

Optional filters (`minBarsSinceFlip`, etc.) are implemented in `shouldPlaceTrendBetAtOpen` — wire them in live if used; shine-trader chart sim may skip them when zero.

### 4.3 Warmup

No bet until `index >= max(structureLookback, exhaustionConsecutiveBars)`.

### 4.4 Parameter tuning (BTC 2025–2026, reference)

Higher WR but fewer trades: `LB=10`, `N=4`. Higher compound sim with **1%**: default **N=3, LB=5** is the documented baseline. Sweeps: `shine-trader-client/scripts/backtest-exhaustion-sweep-btc.mjs`.

**Not adopted:** mean reversion every bar (~51.6% WR, ~105k bets, deep drawdowns at 5% stake).

---

## 5. BoS trend engine

### 5.1 Rules (`analyzeTrendAndBos`)

- Start trend: `long`
- **Long:** if close breaks **below** min low of prior `structureLookback` bars → flip `short`, `bosFlipAt[i]=true`
- **Short:** if close breaks **above** max high of prior `structureLookback` bars → flip `long`, `bosFlipAt[i]=true`

Optional: `minSegmentBars`, `minBarsBetweenFlips`, `breakBuffer`, `bodyBreakOnly`.

### 5.2 Outputs

- `trendAtOpen[]` — input to exhaustion fade  
- `bosFlipAt[]` — analytics / optional entry filters only; **never** for same-bar open signal

### 5.3 Port from

`shine-trader-client/src/utils/chart/detectBreakOfStructure.ts`

---

## 6. Backtest results (BTC, default params)

**Config:** `exhaustionConsecutiveBars=3`, `structureLookback=5`, all other strategy filters off.  
**Sizing:** **1% of balance**, compound, **no cap**.  
**Fees:** 0% (Lighter Standard).  
**Start:** $100.

### 6.1 Full year

| Metric | Value |
|--------|--------|
| Bets | 19,619 |
| Win rate | 53.14% |
| End balance | $8,323,401 |
| Net P/L | +$8,323,301 |
| Min balance | $97.03 |
| Max loss streak | 15 |

### 6.2 Monthly breakdown

| Month | Start | End | Month P/L | Month % | Bets | WR% |
|-------|-------|-----|-----------|---------|------|-----|
| 2025-05 | $100 | $253 | +$153 | +153% | 622 | 57.7 |
| 2025-06 | $253 | $574 | +$321 | +127% | 1622 | 52.8 |
| 2025-07 | $574 | $615 | +$41 | +7% | 1828 | 50.4 |
| 2025-08 | $615 | $900 | +$285 | +46% | 1791 | 51.3 |
| 2025-09 | $900 | $1,061 | +$161 | +18% | 1707 | 50.7 |
| 2025-10 | $1,061 | $4,164 | +$3,103 | +293% | 1651 | 54.4 |
| 2025-11 | $4,164 | $10.4k | +$6,282 | +151% | 1606 | 53.1 |
| 2025-12 | $10.4k | $55.0k | +$44.6k | +427% | 1564 | 55.6 |
| 2026-01 | $55.0k | $239.0k | +$184.0k | +334% | 1633 | 54.7 |
| 2026-02 | $239.0k | $711.7k | +$472.7k | +198% | 1376 | 54.2 |
| 2026-03 | $711.7k | $1.58M | +$866.3k | +122% | 1676 | 52.6 |
| 2026-04 | $1.58M | $5.35M | +$3.78M | +239% | 1564 | 54.2 |
| 2026-05 | $5.35M | $8.32M | +$2.97M | +55% | 979 | 52.5 |

All months positive in this run. Summer months are flat in **%** terms; H2 dominates **dollar** growth because of compound.

### 6.3 Historical note (EURUSD 2015)

Exhaustion fade on EURUSD 2015 (~12k bets) showed ~**54.3%** WR in earlier research. This spec standardizes on **BTC** and **1% compound** for the autotrader.

### 6.4 Fees sensitivity (qualitative)

| Fee model | Effect on default exhaustion @ ~20k bets/year |
|-----------|--------------------------------------------------|
| Lighter 0% | Matches table above (planning) |
| Ostium 5 bps open, oracle refunded | Slightly below 0%; still viable |
| Ostium + $0.10 oracle/trade (no refund) | Do not use for this frequency |
| Polymarket taker | Ruin in sim |

---

## 7. Position sizing — 1% compound, no cap

### 7.1 Rule (mandatory for this project)

```typescript
stake = balance * 0.01   // 1% of current balance
// NO maxStake cap
stake = Math.min(stake, balance - BALANCE_FLOOR)
if (stake < MIN_STAKE) skip bet
```

| Constant | Value |
|----------|--------|
| `BALANCE_FLOOR` | 0.01 |
| `MIN_STAKE` | 0.01 |
| `STAKE_PCT` | **1** |

### 7.2 Ruin guard

If `balance - FLOOR < MIN_STAKE`, skip the bet (do not open). Observed min **$97.03** on BTC year at 1%.

### 7.3 What we explicitly do **not** use

| Setting | Status |
|---------|--------|
| Fixed $ stake as default | No |
| 5% compound as default | No (documented only in legacy scripts) |
| `maxStake` / cap | **No** |
| Leverage > 1× for sizing math | No (collateral = stake at 1×) |

### 7.4 Break-even (0% fee, binary ±stake)

Per bet with stake fraction `s = 0.01`:

- Win multiplier ≈ `1 + s`, loss ≈ `1 - s`  
- Break-even WR ≈ **50%** (exact: `1/(1+(1/s))` for symmetric payout)

Observed **53.14%** > 50% → positive edge in sim before fees.

### 7.5 Interpreting compound balances

1% over ~20k wins still produces **large** simulated dollars ($8.3M from $100). Treat as:

- **Monthly %** and **min balance** for risk  
- **WR** and **bet count** for signal quality  
- Not as guaranteed withdrawable profit

---

## 8. Fee models and venues

### 8.1 Recommended: Lighter Standard

- **0%** maker/taker  
- BTC perp: market open at 5m open → close at +5m  
- **1× leverage**, collateral = **1% of balance**

### 8.2 Alternative: Ostium BTC/USD @ 1×

- **5 bps** on notional at open  
- **No close fee**  
- Oracle **$0.10** at open — assume **refunded** on full close unless you verify otherwise  
- **Funding** over 5m usually small

### 8.3 Polymarket

**Not recommended** for this bot (taker fee ~3.5% of premium at 50¢, fill uncertainty for maker 0%).

### 8.4 Fee formulas (reference)

**Ostium open (1×):**

```
openFee = collateral * 0.0005
oracleFee = 0.10   // planning: 0 if refunded on close
```

**Polymarket taker (if ever used):**

```
entryFee = stake * 0.07 * (1 - p)
```

---

## 9. Live trading pipeline

### 9.1 Architecture

```text
Market data (5m) → Signal (exhaustion fade) → Risk (1% stake, no cap) → Execution (Lighter/Ostium)
                              ↑
                         BoS engine
```

### 9.2 Signal output

```typescript
type Signal =
  | { action: 'long' | 'short'; strategy: 'exhaustionFade' }
  | { action: 'none'; reason: string };
```

Port: `predictExhaustionFadeAtOpen`, `resolveBetAtOpen` (exhaustion mode only).

### 9.3 Risk manager

```typescript
interface RiskConfig {
  stakePercent: 1;           // fixed for this spec
  maxStakeCap: undefined;    // explicitly no cap
  balanceFloor: 0.01;
  minStake: 0.01;
  maxLeverage: 1;
  minCollateralUsd: number;  // exchange minimum
}
```

```typescript
function computeStake(balance: number): number | null {
  const room = balance - balanceFloor;
  const stake = balance * 0.01;
  if (stake < minStake || room < minStake) return null;
  return Math.min(stake, room);
}
```

### 9.4 Execution flow

On **bar open** (UTC 5m boundary):

1. If no signal → return  
2. If position open → return (max 1)  
3. `collateral = computeStake(balance)`  
4. `openPosition({ side, collateralUsd: collateral, leverage: 1 })`  
5. Schedule **full close** at `openTime + 300s`

On close: log PnL, fees, funding; update balance.

### 9.5 Backtest vs live

| Backtest | Live |
|----------|------|
| Bet at bar open | Market order |
| Settle at bar close | Timer close (~5m) |
| PnL = ±1% balance | PnL from price move |
| No slippage | Spread + latency |

---

## 10. TP/SL, leverage, liquidation

- **Strategy exit:** time-based (end of 5m bar).  
- **TP/SL:** not required for logic; optional **disaster SL** (e.g. −2%) if scheduler fails.  
- **Leverage:** **1×** only for v1.  
- Higher leverage incompatible with “many small directional bets” design.

---

## 11. Reference implementation (shine-trader)

| File | Role |
|------|------|
| `detectBreakOfStructure.ts` | BoS, `trendAtOpen` |
| `predictCandleDirectionAtOpen.ts` | `predictExhaustionFadeAtOpen` |
| `resolveBetAtOpen.ts` | Exhaustion branch |
| `shouldPlaceTrendBet.ts` | Optional entry filters |
| `simulateTrendBetStrategy.ts` | Chart backtest (wire filters if non-zero) |
| `safeBetStake.ts` | Floor / min stake |
| `trendBetStrategy.ts` | Params; preset `exhaustionFade` |

UI still lists `meanRevertEveryBar` for research; **autotrader uses exhaustion only**.

---

## 12. Scripts and reproduction

### 12.1 Monthly report (canonical)

```bash
# From repo root; requires tmp_btc_5m_year.json
STAKE_PCT=1 node shine-trader-client/scripts/backtest-exhaustion-default-monthly.mjs
```

Ensures: **N=3, LB=5**, **1% compound**, **no cap**, 0% fees.

### 12.2 Parameter sweep

```bash
node shine-trader-client/scripts/backtest-exhaustion-sweep-btc.mjs
```

### 12.3 Top configs + monthly (ranking experiments)

```bash
STAKE_PCT=1 MIN_EXHAUSTION_N=3 node shine-trader-client/scripts/backtest-exhaustion-top5-monthly.mjs
```

### 12.4 BTC cache download

```bash
set CACHE_FILE=tmp_btc_5m_year.json
node shine-trader-client/scripts/backtest-btc-binance-year.mjs
```

### 12.5 Legacy scripts

`backtest-year-2015.mjs`, `backtest-btc-binance-year.mjs` support multiple strategies and `STAKE_PCT=5` — **not** the autotrader default.

---

## 13. New project blueprint

```text
autotrader/
├── config/default.yaml      # exhaustionFade, stakePercent: 1, no maxStake
├── src/strategy/
│   ├── bos.ts
│   └── exhaustionFade.ts   # only strategy module
├── src/risk/positionSizing.ts   # 1% compound, no cap
├── src/execution/               # LighterAdapter | OstiumAdapter
└── scripts/backtest.ts          # parity with backtest-exhaustion-default-monthly.mjs
```

**Phased rollout:**

1. Parity backtest vs `backtest-exhaustion-default-monthly.mjs`  
2. Paper trade (live feed, no keys)  
3. Small live Lighter 1×, default params  
4. Monitor slippage / funding; do not add mean reversion without new spec

**Tests:** causality (no `close[i]` in signal), BoS fixture parity, one-open-one-close scheduler.

---

## 14. Configuration reference

```yaml
strategy:
  mode: exhaustionFade          # only supported mode
  exhaustionConsecutiveBars: 3
  structureLookback: 5
  bosMinSegmentBars: 0
  bosMinBarsBetweenFlips: 0
  bosBreakBuffer: 0
  bosBodyBreakOnly: false
  minBarsSinceFlip: 0
  maxBarsSinceFlip: 0
  minDistanceFromStructure: 0

symbol: BTCUSDT
timeframe: 5m
timezone: UTC

risk:
  startBalance: 100
  stakeMode: percent
  stakePercent: 1               # 1% compound
  # maxStakeUsd: omitted        # NO CAP
  maxLeverage: 1
  balanceFloor: 0.01
  minStake: 0.01
  minCollateralUsd: 10

execution:
  provider: lighter             # lighter | ostium
  accountType: standard

scheduler:
  barDurationSeconds: 300
  closeRetryAttempts: 3

safety:
  disasterStopLossPercent: 2.0  # optional
  maxDailyLossPercent: 20
```

---

## 15. Risks and limitations

1. **Binary backtest ≠ perp PnL** — BTC can move >1% in 5m; real PnL differs.  
2. **Compound sim** — dollar curves are optimistic; use min balance and monthly %.  
3. **WR ~53%** — thin edge; long loss streaks (max **15** observed).  
4. **No stake cap** — large balances imply large absolute risk per trade in live.  
5. **Operational** — missed close, API lag, funding (Ostium).  
6. **Regime change** — one year BTC only in primary table.

---

## 16. Appendices

### A. Glossary

| Term | Meaning |
|------|---------|
| **Exhaustion fade** | Bet against BoS trend after N same-color closed bars |
| **N / LB** | `exhaustionConsecutiveBars` / `structureLookback` |
| **1% compound** | Stake = 1% of balance; profits reinvested; **no max stake** |
| **trendAtOpen[i]** | BoS trend at bar `i` open (causal) |
| **Doji** | `close == open`, skipped |

### B. Links

- [Polymarket fees](https://docs.polymarket.com/trading/fees)  
- [Ostium fees](https://docs.ostium.com/traders/reference/fees)  
- [Lighter fees](https://docs.lighter.xyz/trading/trading-fees)  
- [Binance klines](https://api.binance.com/api/v3/klines)  

---

*End of specification.*
