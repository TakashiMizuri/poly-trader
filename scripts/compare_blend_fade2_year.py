#!/usr/bin/env python3
"""Compare blend_fade2 Python vs exported golden for a calendar year."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TCM = Path(r"C:\All\Develop\trading-cursor-models")
if str(TCM) not in sys.path:
    sys.path.insert(0, str(TCM))

from strategies.blend_fade2.config import preset_pnl_max
from strategies.blend_fade2.signals import generate_signals
from strategies.lib.polymarket import simulate_polymarket_bets


def load_year(year: int) -> list[dict]:
    path = TCM / "data" / "binance" / "btcusdt_5m" / f"btcusdt_5m_{year}.json"
    with path.open(encoding="utf-8") as f:
        payload = json.load(f)
    klines = payload["klines"]
    klines.sort(key=lambda c: c["open_time"])
    return klines


def main() -> None:
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2022
    klines = load_year(year)
    open_times = [int(k["open_time"]) for k in klines]
    opens = [float(k["open"]) for k in klines]
    highs = [float(k["high"]) for k in klines]
    lows = [float(k["low"]) for k in klines]
    closes = [float(k["close"]) for k in klines]

    cfg = preset_pnl_max()
    sig = generate_signals(open_times, opens, highs, lows, closes, cfg)

    entries = [
        (i, sig.side[i])
        for i in range(len(sig.entry_bar))
        if sig.entry_bar[i] and sig.side[i] is not None
    ]

    _, stats = simulate_polymarket_bets(
        opens,
        closes,
        sig.entry_bar,
        sig.side,
        starting_balance_usd=100.0,
        stake_pct=0.03,
        entry_fee_rate=0.018,
        max_stake_usd=500.0,
    )

    out = {
        "year": year,
        "bars": len(klines),
        "preset": "blend2_pnl_max",
        "config": {
            "lookback": cfg.lookback,
            "lookback_fast": cfg.lookback_fast,
            "z_threshold": cfg.z_threshold,
            "min_range_pct": cfg.min_range_pct,
            "z_fast_min": cfg.z_fast_min,
        },
        "entries_count": len(entries),
        "entries": entries,
        "backtest": {
            "bets": stats.bets,
            "wins": stats.wins,
            "losses": stats.losses,
            "pushes": stats.pushes,
            "win_rate_pct": round(stats.win_rate * 100, 4),
            "starting_balance_usd": stats.starting_balance_usd,
            "ending_balance_usd": round(stats.ending_balance_usd, 2),
            "total_pnl_usd": round(stats.total_pnl_usd, 2),
            "total_fees_usd": round(stats.total_fees_usd, 2),
            "max_drawdown_usd": round(stats.max_drawdown_usd, 2),
            "max_drawdown_pct": round(stats.max_drawdown_pct * 100, 4),
        },
    }

    out_path = ROOT / "tests" / f"golden_blend2_{year}_python.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out, f)
    print(json.dumps({k: v for k, v in out.items() if k != "entries"}, indent=2))
    print(f"Wrote {out_path} ({len(entries)} entries)")


if __name__ == "__main__":
    main()
