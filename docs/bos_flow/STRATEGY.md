# BoS Flow (`bos_flow`)

High-frequency BoS strategy for BTCUSDT 5m with a default **BoS fade** mode.

Ported from `trading-cursor-models/strategies/bos_flow`. Implementation lives in:

- **Backend:** `src/PolyTrader.Core/Strategy/BosFlowSignals.cs`, `BosFlowConfig.cs`
- **Frontend:** `client/src/utils/chart/bosFlowSignals.ts`, `client/src/types/bosFlowConfig.ts`

## Best preset (`flow_active`)

- `swing_left=2`, `swing_right=2`
- `min_break_pct=0.0001`
- `ema_period=50`
- `max_bias_bars=18`
- `min_body_ratio=0.05`
- `fade_bos=True`
- `use_rsi_gate=False`
- 24h session (no UTC filter)

## Polymarket execution (defaults in app)

- Stake: `min(3% of balance, $500)` — see root `STRATEGY.md`
- Entry fee: `1.8%` of stake
- Win: `close > open` for long, `close < open` for short
- Decision at bar open using only prior closed bars (live engine runs on each 5m kline close → entry for the new bar)

Full spec: [`STRATEGY.md`](../../STRATEGY.md) in the repo root.
