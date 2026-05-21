# Blend Fade 2 (`blend_fade2`)

Z-score mean-reversion strategy for BTCUSDT 5m Polymarket direction bets.

## Implementation spec (for trading bot)

- **Symbol/TF:** `BTCUSDT`, `5m`.
- **Decision moment:** exactly at open of bar `i`.
- **Allowed inputs at decision:** bar `i` open time (session gate) + full close history up to `i-1`.
- **Forbidden at decision:** `high[i]`, `low[i]`, `close[i]`.
- **Output per bar:** `long`, `short`, or skip (no bet).

## Parameters (default: `blend2_pnl_max`)

- `lookback=48`, `lookback_fast=18`
- `z_threshold=1.08`
- `min_range_pct=0.0026`
- `z_fast_min=0.60`
- `z_reversal=False`, `rank_confirm=0`, `z_max=0` (extras off)
- `session_utc_start=None`, `session_utc_end=None` (24h)

## Exact signal logic

Ported 1:1 from `trading-cursor-models/strategies/blend_fade2/signals.py`. See [`docs/blend_fade2/STRATEGY.md`](docs/blend_fade2/STRATEGY.md).

### Z-score

For index `closed` and lookback `L`:

- Window: `closes[closed - L : closed]` (exclusive end — does not include `closed` in mean/std).
- `z = (closes[closed] - mean) / std`; skip if `std <= 0`.

### Side

- `z > z_threshold` → **short** (fade stretched up move)
- `z < -z_threshold` → **long**

### Gates (in order)

1. Session UTC hour on `open_time[i]` if configured.
2. `closed >= max(lookback, lookback_fast) + 1`.
3. `min_range_pct`: over `closes[closed - lookback : closed + 1]`, `(max - min) / closes[closed - lookback] >= min_range_pct`.
4. `z_max` if `> 0`: cap slow |z|.
5. `z_reversal` if true: slow z must move back toward mean vs previous bar.
6. `z_fast_min` if `> 0`: fast z on `lookback_fast` must confirm fade.
7. `rank_confirm` if `> 0`: close percentile in range must be extreme enough.

Emit entry at bar `i` open when all pass.

## Bot execution semantics

- Place bet at bar open.
- Resolve on bar close: long wins if `close > open`, short if `close < open`.

## Sizing and fees

- `stake = min(3% * balance, $500)` (`BetStakePercent=3`, `MaxBetStakeUsd=500`)
- Entry fee = `1.8%` of stake
- Polymarket payout model in simulator: shares at entry price 0.5 default

## Code locations

| Layer | Files |
|-------|--------|
| C# signals | `BlendFade2Signals.cs`, `BlendFade2Config.cs` |
| C# engine | `TrendBetStrategySimulator.cs`, `BetResolver.cs` |
| TypeScript | `blendFade2Signals.ts`, `blendFade2Config.ts` |

## Presets

```csharp
BlendFade2Config.PresetActive();   // blend2_active (50/20, zf=0.64)
BlendFade2Config.PresetPnlMax();     // default in app (48/18, zf=0.60)
```
