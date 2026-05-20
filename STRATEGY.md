# BoS Flow (`bos_flow`)

High-frequency BoS strategy for BTCUSDT 5m with a default **BoS fade** mode.

## Implementation spec (for trading bot)

This section is intentionally strict so another model can implement the bot without guessing.

- **Symbol/TF:** `BTCUSDT`, `5m`.
- **Decision moment:** exactly at open of bar `i`.
- **Allowed inputs at decision:** `open[i]` + full OHLC history up to `i-1`.
- **Forbidden at decision:** `high[i]`, `low[i]`, `close[i]` (future inside current bar).
- **Output per bar:** one of `long`, `short`, `skip`.

## Data model

Assume arrays indexed by bar number:

- `open[i]`, `high[i]`, `low[i]`, `close[i]`, `open_time_ms[i]`.
- Bars are sorted by `open_time_ms` ascending.
- No gaps assumption is optional; logic works even with gaps.

## Parameters (active preset)

- `swing_left=2`
- `swing_right=2`
- `min_break_pct=0.0001`
- `ema_period=50`
- `max_bias_bars=18`
- `min_body_ratio=0.05`
- `use_rsi_gate=False` (`rsi_period=14` is ignored when False)
- `allow_long=True`
- `allow_short=True`
- `fade_bos=True`
- `session_utc_start=None`, `session_utc_end=None` (24h)

## Exact signal logic

### 1) Swing confirmation

For each bar `i`, at runtime you can confirm pivot candidate at index:

- `confirm_idx = i - swing_right`

Confirm swing high if:

- `high[confirm_idx]` is strictly greater than every `high[j]`
- for `j` in `[confirm_idx - swing_left, ..., confirm_idx + swing_right]`, `j != confirm_idx`

Confirm swing low symmetrically with `low`.

Store recent swings (rolling window is optional; 40-60 is enough).

### 2) BoS detection on last closed candle

At open of bar `i`, work with `closed = i - 1`.

- If `close[closed] > last_swing_high * (1 + min_break_pct)`: structure context becomes **bullish**
- If `close[closed] < last_swing_low * (1 - min_break_pct)`: structure context becomes **bearish**

On new BoS set `bias_age = 0`.
If no new BoS and context exists: `bias_age += 1`.
If `bias_age > max_bias_bars`: drop context (`bias=None`).

### 3) Context -> trade side mapping

- If `fade_bos=False`: trade in context direction (`bullish -> long`, `bearish -> short`)
- If `fade_bos=True` (active): invert direction (`bullish -> short`, `bearish -> long`)

### 4) Bar-quality gates (must pass)

Using `closed = i - 1`:

- `range = high[closed] - low[closed]`; if `range <= 0` -> `skip`
- `body_ratio = abs(close[closed] - open[closed]) / range`
- require `body_ratio >= min_body_ratio`

EMA gate (with `ema_period` on closes):

- For final **long** signal:
  - when `fade_bos=False`: require `close[closed] > ema[closed]`
  - when `fade_bos=True`: require `close[closed] < ema[closed]`
- For final **short** signal:
  - when `fade_bos=False`: require `close[closed] < ema[closed]`
  - when `fade_bos=True`: require `close[closed] > ema[closed]`

Body direction gate:

- Used only when `fade_bos=False`:
  - long requires `close[closed] > open[closed]`
  - short requires `close[closed] < open[closed]`
- In `fade_bos=True` it is intentionally disabled.

Session gate (if configured):

- Compute UTC hour from `open_time_ms[i]`.
- If outside session interval -> `skip`.

RSI gate (only if `use_rsi_gate=True`):

- Long requires `rsi[closed] >= rsi_long_min`
- Short requires `rsi[closed] <= rsi_short_max`

### 5) Final decision at open `i`

If all gates pass:

- emit `long` or `short` for bar `i`

Else:

- emit `skip`.

No pyramiding logic here: each bar decision is independent.

## Bot execution semantics

For Polymarket-like 5m binary market:

- Place bet immediately at bar open.
- Resolve on bar close:
  - `long` wins if `close[i] > open[i]`
  - `short` wins if `close[i] < open[i]`
  - equality can be treated as loss (current backtest default).

## Sizing and fees used in this project

- `stake = min(0.03 * current_balance, 500.0)` (3% of balance; see `stake_pct` sweep below)
- Entry fee = `1.8%` of stake (charged once on entry)
- Payout model in backtest = `+stake` / `-stake` before fee
- Net PnL per bet = gross PnL - entry fee

Constants in `config.py`: `DEFAULT_STAKE_PCT=0.03`, `DEFAULT_MAX_STAKE_USD=500`.

## Minimal pseudocode (Python-like)

```python
def on_backtest(open, high, low, close, open_time_ms, cfg):
    ema = calc_ema(close, cfg.ema_period)
    rsi = calc_rsi(close, cfg.rsi_period) if cfg.use_rsi_gate else None

    swing_highs = []
    swing_lows = []
    bias = None            # "long_context" | "short_context" | None
    bias_age = 0

    signals = ["skip"] * len(open)   # decision at open[i]

    for i in range(len(open)):
        # 1) confirm swings at confirm_idx = i - swing_right
        confirm_idx = i - cfg.swing_right
        if confirm_idx >= cfg.swing_left:
            if is_swing_high(high, confirm_idx, cfg.swing_left, cfg.swing_right):
                swing_highs.append(high[confirm_idx])
            if is_swing_low(low, confirm_idx, cfg.swing_left, cfg.swing_right):
                swing_lows.append(low[confirm_idx])

        closed = i - 1
        if closed < 1:
            continue

        # 2) detect BoS on last closed candle
        if swing_highs and close[closed] > swing_highs[-1] * (1 + cfg.min_break_pct):
            bias = "long_context"
            bias_age = 0
        elif swing_lows and close[closed] < swing_lows[-1] * (1 - cfg.min_break_pct):
            bias = "short_context"
            bias_age = 0
        elif bias is not None:
            bias_age += 1
            if bias_age > cfg.max_bias_bars:
                bias = None

        if bias is None:
            continue

        # session filter (on current bar open time)
        if not session_ok(open_time_ms[i], cfg.session_utc_start, cfg.session_utc_end):
            continue

        # 3) map context to signal side
        if cfg.fade_bos:
            side = "short" if bias == "long_context" else "long"
        else:
            side = "long" if bias == "long_context" else "short"

        # allow_long / allow_short
        if side == "long" and not cfg.allow_long:
            continue
        if side == "short" and not cfg.allow_short:
            continue

        # 4) body/range gate
        rng = high[closed] - low[closed]
        if rng <= 0:
            continue
        body_ratio = abs(close[closed] - open[closed]) / rng
        if body_ratio < cfg.min_body_ratio:
            continue

        # body direction gate only in non-fade mode
        if not cfg.fade_bos:
            if side == "long" and not (close[closed] > open[closed]):
                continue
            if side == "short" and not (close[closed] < open[closed]):
                continue

        # EMA gate
        if ema[closed] is not None:
            if side == "long":
                if (not cfg.fade_bos and close[closed] <= ema[closed]) or \
                   (cfg.fade_bos and close[closed] >= ema[closed]):
                    continue
            else:  # short
                if (not cfg.fade_bos and close[closed] >= ema[closed]) or \
                   (cfg.fade_bos and close[closed] <= ema[closed]):
                    continue

        # optional RSI gate
        if cfg.use_rsi_gate and rsi[closed] is not None:
            if side == "long" and rsi[closed] < cfg.rsi_long_min:
                continue
            if side == "short" and rsi[closed] > cfg.rsi_short_max:
                continue

        # final decision at open[i]
        signals[i] = side

    return signals


def settle_polymarket_bar(side, o, c, balance, stake_pct=0.03, max_stake=500.0, fee_rate=0.018):
    stake = min(balance * stake_pct, max_stake)
    fee = stake * fee_rate
    if side == "long":
        gross = +stake if c > o else -stake
    elif side == "short":
        gross = +stake if c < o else -stake
    else:
        return balance
    return balance + (gross - fee)
```

## Objective

- Output at each new candle open: `long` / `short` / `skip`.
- Keep win rate above 50% in 1:1 Polymarket model.
- Maximize number of bets (more opportunities than `bos_retest`).

## Core idea

1. Confirm local swings with small fractal (`2x2` by default).
2. On each closed bar, detect BoS:
   - bullish if close breaks last swing high by `min_break_pct`
   - bearish if close breaks last swing low by `min_break_pct`
3. Maintain structure context for `max_bias_bars`.
4. At next bar open, emit signal if momentum gates pass:
   - previous candle body direction agrees with bias
   - body/range above `min_body_ratio`
   - previous close on correct side of EMA
   - optional RSI gate
5. If `fade_bos=True` (default), signal direction is inverted (mean-reversion):
   - bullish BoS context -> short
   - bearish BoS context -> long

This setup keeps BoS context but trades it as short-horizon exhaustion on 5m.

## Quick run

```bash
py -3 strategies/run_backtest.py --strategy bos_flow --preset flow_active
py -3 strategies/bos_flow/monthly_report.py --years 2020 2021 2022 2023 2024 2025
py -3 strategies/bos_flow/sweep_stake_pct.py
py -3 strategies/bos_flow/tune.py --limit 120 --min-wr 50
```

## Best variant used

Current best working setup in this project is `--preset flow_active` with:

- `fade_bos=True` (contrarian from BoS context)
- `swing_left=2`, `swing_right=2`
- `min_break_pct=0.0001` (see parameter sweep below; was `0.0006` before May 2026 sweep)
- `ema_period=50`
- `max_bias_bars=18`
- `min_body_ratio=0.05`
- `use_rsi_gate=False`
- `allow_long=True`, `allow_short=True`
- `session_utc_start=None`, `session_utc_end=None` (24h)
- **Execution:** `stake_pct=3%` of balance, cap `$500`, entry fee `1.8%` (see `stake_pct` sweep below)

### `min_break_pct` sweep (May 2026)

Swept `min_break_pct` from `0.0001` to `0.0010` (step `0.0001`) on `BTCUSDT 5m`, years `2020..2025`, all other `flow_active` params fixed. Polymarket model: `$100` start, `1%` stake capped at `$500`, `1.8%` entry fee (stake sweep below picked `3%` afterward).

| min_break_pct | Bets | WR% | Total PnL |
|---------------|------|-----|-----------|
| **0.0001** | **448,116** | **52.56** | **+$7,117,062** |
| 0.0002 | 444,800 | 52.55 | +$7,029,953 |
| 0.0003 | 439,566 | 52.56 | +$7,003,308 |
| 0.0004 | 433,289 | 52.55 | +$6,854,518 |
| 0.0005 | 426,487 | 52.57 | +$6,819,731 |
| 0.0006 (prev default) | 418,411 | 52.58 | +$6,716,095 |
| 0.0007 | 410,315 | 52.56 | +$6,511,522 |
| 0.0008 | 401,303 | 52.55 | +$6,302,839 |
| 0.0009 | 392,531 | 52.50 | +$5,958,808 |
| 0.0010 | 383,511 | 52.48 | +$5,760,855 |

**Winner:** `0.0001` — highest total PnL (+~$401k vs previous default `0.0006`). Lower threshold → more BoS triggers → more bets; WR stays ~52.5% across the range.

Re-run sweep:

```bash
py -3 strategies/bos_flow/sweep_min_break.py --years 2020 2021 2022 2023 2024 2025
```

Compact pivots: `strategies/bos_flow/sweep_summary.txt`. Full monthly tables: `strategies/bos_flow/sweep_min_break_out.txt`.

### `stake_pct` sweep (May 2026)

With `min_break_pct=0.0001` fixed, swept stake from `1%` to `5%` (step `1%`) on `2020..2025`. Same bets/WR at every level; PnL differs mainly in `2020` before the `$500` cap binds.

| stake_pct | Bets | WR% | Total PnL | Max DD ($) | Max DD (% peak) |
|-----------|------|-----|-----------|------------|-----------------|
| 1% | 448,116 | 52.56 | +$7,117,062 | $211,116 | **2.96%** |
| 2% | 448,116 | 52.56 | +$7,237,839 | $211,116 | 2.91% |
| **3%** | **448,116** | **52.56** | **+$7,282,932** | **$211,116** | **2.89%** |
| 4% | 448,116 | 52.56 | +$7,274,844 | $211,116 | 2.90% |
| 5% | 448,116 | 52.56 | +$7,161,232 | $211,116 | 2.94% |

**Winner:** `3%` — highest total PnL (+~$166k vs `1%`). Max drawdown in USD is the same for all levels (`$211,116`); lowest DD as % of peak is also at `3%` (2.89%).

Re-run:

```bash
py -3 strategies/bos_flow/sweep_stake_pct.py --years 2020 2021 2022 2023 2024 2025
```

Summary: `strategies/bos_flow/sweep_stake_summary.txt`. Monthly tables: `strategies/bos_flow/sweep_stake_out.txt`.

### Backtest execution settings

- Data: `BTCUSDT 5m`, years `2020..2025`
- Decision timing: at candle open (`long` / `short` / `skip`) using only past bars + current open
- Payout model: Polymarket-like `1:1` on stake (`+stake` win, `-stake` loss)
- Stake sizing: `stake = min(3% of current balance, $500)` (`DEFAULT_STAKE_PCT` in `config.py`)
- Entry fee: `1.8%` of stake (entry only)
- Start balance: `$100`

Command used:

```bash
py -3 strategies/bos_flow/monthly_report.py --years 2020 2021 2022 2023 2024 2025 --preset flow_active
```

(`flow_active`: `min_break_pct=0.0001`; scripts default to `stake_pct=0.03`, `max_stake_usd=500`.)

### Result summary (2020-2025, `flow_active` + 3% stake)

- Ending balance: `$7,283,032.31` (start `$100` + net PnL)
- Net PnL: `+$7,282,932.31`
- Bets: `448,116`
- Win rate: `52.56%`
- Max drawdown: `$211,116` (2.89% of peak)

PnL figures use compounding stake sizing; compare variants relatively, not as literal forward returns.

### Yearly PnL breakdown (`min_break_pct=0.0001`, `stake_pct=3%`)

- `2020`: `+$1,444,075.31`
- `2021`: `+$1,548,555.00`
- `2022`: `+$1,673,837.00`
- `2023`: `+$1,433,778.00`
- `2024`: `+$844,321.00`
- `2025`: `+$338,366.00`

Note: `2025` PnL is highest at `min_break_pct=0.0006` with `1%` stake in the earlier sweep; combined tuned preset keeps `0.0001` + `3%` for best six-year total.

Monthly details: `strategies/bos_flow/monthly_report.py`, `sweep_min_break.py`, or `sweep_stake_pct.py`.
