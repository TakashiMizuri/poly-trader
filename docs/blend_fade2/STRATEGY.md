# Blend Fade 2 (`blend_fade2`)

Z-score mean-reversion on BTCUSDT 5m closes. Lab fork of `blend_fade` with optional extra filters (`z_reversal`, `rank_confirm`, `z_max`).

Ported from `trading-cursor-models/strategies/blend_fade2`. Implementation:

- **Backend:** `src/PolyTrader.Core/Strategy/BlendFade2Signals.cs`, `BlendFade2Config.cs`
- **Frontend:** `client/src/utils/chart/blendFade2Signals.ts`, `client/src/types/blendFade2Config.ts`

## Default preset (`blend2_pnl_max`)

Best PnL from search_tune (batch 2):

| Parameter | Value |
|-----------|-------|
| `lookback` / `lookback_fast` | 48 / 18 |
| `z_threshold` | 1.08 |
| `min_range_pct` | 0.0026 |
| `z_fast_min` | 0.60 |
| `z_reversal` | false |
| `rank_confirm` | 0 |
| `z_max` | 0 |

Base preset `blend2_active` (same as blend_fade `blend_active`): `lb=50/20`, `z=1.08`, `rng=0.0026`, `zf=0.64`.

## Signal logic (summary)

At open of bar `i`, using only closes through bar `i-1`:

1. Slow z-score on `close[i-1]` over `lookback`; fade when `z > z_threshold` → **short**, `z < -z_threshold` → **long**.
2. Optional `min_range_pct`: range over last `lookback` closes must exceed threshold.
3. Optional `z_fast_min`: fast z (over `lookback_fast`) must agree with fade direction.
4. Optional `z_reversal`, `rank_confirm`, `z_max` (off in default presets).

## Polymarket execution (app defaults)

- Stake: `min(3% of balance, $500)`
- Entry fee: `1.8%` of stake
- Win: `close > open` for long, `close < open` for short
- On each 5m kline close: settle bet opened at that bar’s open; open next bar if signaled

Full source spec: `trading-cursor-models/strategies/blend_fade2/STRATEGY.md`.
