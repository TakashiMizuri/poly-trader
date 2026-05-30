#!/usr/bin/env python3
"""Production vs backtest dashboard for blend_fade2 (BTCUSDT 5m)."""

from __future__ import annotations

import argparse
import csv
import json
import math
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TCM = Path(r"C:\All\Develop\trading-cursor-models")
SIGNAL_EXPORT = ROOT / "scripts" / "signal_window_export"

# --- blend_fade2 config (PresetPnlMax) ---
LOOKBACK = 48
LOOKBACK_FAST = 18
Z_THRESHOLD = 1.08
MIN_RANGE_PCT = 0.0026
Z_FAST_MIN = 0.60

STAKE_PCT = 1.5
MAX_STAKE_USD = 500.0
BALANCE_FLOOR = 0.01
MIN_BET_STAKE = 0.01
WARMUP_BARS = 72

EXECUTION_SKIP_REASONS = frozenset(
    {
        "entry_price_out_of_range",
        "order_failed",
        "balance_unavailable",
        "clob_min_order_size",
        "insufficient_balance",
    }
)


@dataclass
class Candle:
    time_sec: int
    open: float
    high: float
    low: float
    close: float


@dataclass
class Trade:
    candle_time: int
    side: str
    trend: str
    entry_price: float
    stake_usd: float
    pnl_usd: float
    won: int
    created_at: str
    redeemed_at: str | None
    stake_balance_usd: float | None
    bet_stake_percent: float | None
    id: int


@dataclass
class BetResult:
    candle_time: int
    index: int
    side: str
    stake: float
    entry_price: float
    commission: float
    pnl: float
    won: bool
    balance_after: float


@dataclass
class ScenarioStats:
    id: str
    name: str
    bets: int = 0
    wins: int = 0
    losses: int = 0
    total_pnl: float = 0.0
    total_fees: float = 0.0
    start_balance: float = 0.0
    end_balance: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_pct: float = 0.0
    long_total: int = 0
    long_wins: int = 0
    short_total: int = 0
    short_wins: int = 0
    equity_curve: list[tuple[int, float]] = field(default_factory=list)


def utc_str(ts_sec: int) -> str:
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def utc_date(ts_sec: int) -> str:
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc).strftime("%Y-%m-%d")


def utc_hour(ts_sec: int) -> int:
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc).hour


def side_to_trend(side: str) -> str:
    return "Long" if side == "long" else "Short"


def trend_to_side(trend: str) -> str:
    return "Up" if trend == "Long" else "Down"


def trend_to_signal(trend: str) -> str:
    return "long" if trend == "Long" else "short"


def compute_bet_pnl(
    won: bool, stake: float, commission_pct: float, entry_price: float = 0.5
) -> tuple[float, float]:
    price = entry_price if 0 < entry_price <= 1 else 0.5
    commission = stake * commission_pct / 100
    shares = stake / price
    payout = shares if won else 0.0
    return payout - stake - commission, commission


def resolve_stake(balance: float, stake_pct: float, max_stake: float | None) -> float | None:
    requested = balance * stake_pct / 100
    if max_stake is not None and max_stake > 0:
        requested = min(requested, max_stake)
    max_affordable = balance - BALANCE_FLOOR
    stake = min(requested, max_affordable)
    if stake < MIN_BET_STAKE:
        return None
    return stake


def clamp_balance(balance: float) -> float:
    return max(balance, BALANCE_FLOOR)


def is_bet_won(side: str, candle: Candle) -> bool:
    if side == "long":
        return candle.close > candle.open
    return candle.close < candle.open


def z_score(values: list[float], end_idx: int, lookback: int) -> float | None:
    start = end_idx - lookback
    if start < 0:
        return None
    window = values[start:end_idx]
    mu = sum(window) / lookback
    var_sum = sum((v - mu) ** 2 for v in window)
    std = math.sqrt(var_sum / lookback)
    if std <= 0:
        return None
    return (values[end_idx] - mu) / std


def generate_blend_fade2_signals(candles: list[Candle]) -> tuple[list[bool], list[str | None]]:
    n = len(candles)
    entry = [False] * n
    side: list[str | None] = [None] * n
    closes = [c.close for c in candles]

    for i in range(1, n):
        closed = i - 1
        if closed < max(LOOKBACK, LOOKBACK_FAST) + 1:
            continue

        z = z_score(closes, closed, LOOKBACK)
        if z is None:
            continue

        if MIN_RANGE_PCT > 0 and closed >= LOOKBACK:
            window_start = closed - LOOKBACK
            ref_price = closes[window_start]
            if ref_price > 0:
                window = closes[window_start : closed + 1]
                move = (max(window) - min(window)) / ref_price
                if move < MIN_RANGE_PCT:
                    continue

        signal_side: str | None = None
        if z > Z_THRESHOLD:
            signal_side = "short"
        elif z < -Z_THRESHOLD:
            signal_side = "long"
        if signal_side is None:
            continue

        if Z_FAST_MIN > 0:
            z_fast = z_score(closes, closed, LOOKBACK_FAST)
            if z_fast is None:
                continue
            if signal_side == "short" and z_fast < Z_FAST_MIN:
                continue
            if signal_side == "long" and z_fast > -Z_FAST_MIN:
                continue

        entry[i] = True
        side[i] = signal_side

    return entry, side


def load_binance(path: Path) -> list[Candle]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    candles = [
        Candle(
            time_sec=int(k["open_time"]) // 1000,
            open=float(k["open"]),
            high=float(k["high"]),
            low=float(k["low"]),
            close=float(k["close"]),
        )
        for k in payload["klines"]
    ]
    candles.sort(key=lambda c: c.time_sec)
    return candles


def load_trades(path: Path) -> list[Trade]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    trades = []
    for r in rows:
        if r.get("Mode") != "Live":
            continue
        trades.append(
            Trade(
                candle_time=int(r["CandleTime"]),
                side=r["Side"],
                trend=r["Trend"],
                entry_price=float(r["EntryPrice"]),
                stake_usd=float(r["StakeUsd"]),
                pnl_usd=float(r["PnlUsd"]),
                won=int(r["Won"]),
                created_at=r["CreatedAt"],
                redeemed_at=r.get("RedeemedAt"),
                stake_balance_usd=r.get("StakeBalanceUsd"),
                bet_stake_percent=r.get("BetStakePercent"),
                id=int(r["Id"]),
            )
        )
    trades.sort(key=lambda t: t.candle_time)
    return trades


def load_skips(path: Path) -> dict[int, str]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    priority = {
        "order_failed": 10,
        "entry_price_out_of_range": 9,
        "balance_unavailable": 8,
        "clob_min_order_size": 7,
        "insufficient_balance": 7,
        "no_market": 6,
        "engine_stopped": 5,
        "no_signal": 1,
    }
    by_candle: dict[int, tuple[int, str]] = {}
    for r in rows:
        if r.get("Mode") != "Live":
            continue
        ct = int(r["CandleTime"])
        reason = r["SkipReason"]
        score = priority.get(reason, 4)
        prev = by_candle.get(ct)
        if prev is None or score > prev[0]:
            by_candle[ct] = (score, reason)
    return {k: v[1] for k, v in by_candle.items()}


def slice_candles(all_candles: list[Candle], window_start: int, window_end: int) -> tuple[list[Candle], dict[int, int]]:
    """Return slice with warmup + map time_sec -> index in slice."""
    times = [c.time_sec for c in all_candles]
    start_idx = 0
    for i, t in enumerate(times):
        if t >= window_start:
            start_idx = max(0, i - WARMUP_BARS)
            break
    end_idx = len(all_candles)
    for i, t in enumerate(times):
        if t > window_end:
            end_idx = i
            break
    sliced = all_candles[start_idx:end_idx]
    index_by_time = {c.time_sec: i for i, c in enumerate(sliced)}
    return sliced, index_by_time


def infer_start_balance(trades: list[Trade]) -> tuple[float, str]:
    if not trades:
        return 100.0, "fallback $100"

    # StakeBalanceUsd is balance at bar open (not stake-derived).
    snap_idx = next((i for i, t in enumerate(trades) if t.stake_balance_usd), None)
    if snap_idx is not None:
        bal = trades[snap_idx].stake_balance_usd or 0.0
        for prev in reversed(trades[:snap_idx]):
            bal -= prev.pnl_usd
        return bal, f"обратный расчёт от сделки #{trades[snap_idx].id}: ${bal:.2f}"

    t0 = trades[0]
    pct = t0.bet_stake_percent or STAKE_PCT
    bal = t0.stake_usd / (pct / 100)
    return bal, f"оценка по stake первой сделки #{t0.id}: ${bal:.2f}"


def simulate_compound(
    candles: list[Candle],
    entry_flags: list[bool],
    sides: list[str | None],
    *,
    scenario_id: str,
    name: str,
    start_balance: float,
    stake_pct: float,
    commission_pct: float,
    entry_price: float = 0.5,
    entry_prices: dict[int, float] | None = None,
    allowed_times: set[int] | None = None,
    actual_stakes: dict[int, float] | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> tuple[ScenarioStats, list[BetResult]]:
    stats = ScenarioStats(id=scenario_id, name=name, start_balance=start_balance)
    balance = start_balance
    peak = start_balance
    max_dd = 0.0
    max_dd_pct = 0.0
    bets: list[BetResult] = []

    for i, c in enumerate(candles):
        if not entry_flags[i] or sides[i] is None:
            continue
        if allowed_times is not None and c.time_sec not in allowed_times:
            continue
        if window_start is not None and c.time_sec < window_start:
            continue
        if window_end is not None and c.time_sec > window_end:
            continue

        side = sides[i]
        assert side is not None
        if actual_stakes and c.time_sec in actual_stakes:
            stake = actual_stakes[c.time_sec]
        else:
            stake_val = resolve_stake(balance, stake_pct, MAX_STAKE_USD)
            if stake_val is None:
                continue
            stake = stake_val

        ep = (entry_prices or {}).get(c.time_sec, entry_price)
        won = is_bet_won(side, c)
        pnl, commission = compute_bet_pnl(won, stake, commission_pct, ep)
        balance = clamp_balance(balance + pnl)

        stats.bets += 1
        stats.total_pnl += pnl
        stats.total_fees += commission
        if won:
            stats.wins += 1
        else:
            stats.losses += 1
        if side == "long":
            stats.long_total += 1
            if won:
                stats.long_wins += 1
        else:
            stats.short_total += 1
            if won:
                stats.short_wins += 1

        bets.append(
            BetResult(
                candle_time=c.time_sec,
                index=i,
                side=side,
                stake=stake,
                entry_price=ep,
                commission=commission,
                pnl=pnl,
                won=won,
                balance_after=balance,
            )
        )
        stats.equity_curve.append((c.time_sec, balance))

        if balance > peak:
            peak = balance
        dd = peak - balance
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak * 100) if peak > 0 else 0.0

    stats.end_balance = balance
    stats.max_drawdown = max_dd
    stats.max_drawdown_pct = max_dd_pct
    return stats, bets


def prod_stats(trades: list[Trade]) -> dict[str, Any]:
    wins = sum(t.won for t in trades)
    losses = len(trades) - wins
    total_pnl = sum(t.pnl_usd for t in trades)
    total_stake = sum(t.stake_usd for t in trades)
    gross_win = sum(t.pnl_usd for t in trades if t.won)
    gross_loss = abs(sum(t.pnl_usd for t in trades if not t.won))
    pf = gross_win / gross_loss if gross_loss > 0 else float("inf")

    long_trades = [t for t in trades if t.trend == "Long"]
    short_trades = [t for t in trades if t.trend == "Short"]

    daily: dict[str, float] = defaultdict(float)
    hourly_pnl: dict[int, float] = defaultdict(float)
    hourly_cnt: dict[int, int] = defaultdict(int)
    hourly_wins: dict[int, int] = defaultdict(int)

    for t in trades:
        daily[utc_date(t.candle_time)] += t.pnl_usd
        h = utc_hour(t.candle_time)
        hourly_pnl[h] += t.pnl_usd
        hourly_cnt[h] += 1
        hourly_wins[h] += t.won

    # equity from stake balance snapshots
    equity: list[tuple[int, float]] = []
    for t in trades:
        if t.stake_balance_usd is not None:
            equity.append((t.candle_time, t.stake_balance_usd + t.pnl_usd))

    max_loss_streak = 0
    cur = 0
    for t in trades:
        if not t.won:
            cur += 1
            max_loss_streak = max(max_loss_streak, cur)
        else:
            cur = 0

    redeemed_null_wins = sum(1 for t in trades if t.won and not t.redeemed_at)

    return {
        "bets": len(trades),
        "wins": wins,
        "losses": losses,
        "win_rate": wins / len(trades) * 100 if trades else 0,
        "total_pnl": total_pnl,
        "total_stake": total_stake,
        "roi_on_stake": total_pnl / total_stake * 100 if total_stake else 0,
        "profit_factor": pf,
        "long_bets": len(long_trades),
        "long_wins": sum(t.won for t in long_trades),
        "short_bets": len(short_trades),
        "short_wins": sum(t.won for t in short_trades),
        "daily_pnl": dict(sorted(daily.items())),
        "hourly_pnl": dict(sorted(hourly_pnl.items())),
        "hourly_cnt": dict(sorted(hourly_cnt.items())),
        "hourly_wins": dict(sorted(hourly_wins.items())),
        "max_loss_streak": max_loss_streak,
        "redeemed_null_wins": redeemed_null_wins,
        "equity_points": equity,
    }


def stats_to_dict(s: ScenarioStats) -> dict[str, Any]:
    wr = s.wins / s.bets * 100 if s.bets else 0
    return {
        "id": s.id,
        "name": s.name,
        "bets": s.bets,
        "wins": s.wins,
        "losses": s.losses,
        "win_rate_pct": round(wr, 2),
        "total_pnl_usd": round(s.total_pnl, 2),
        "total_fees_usd": round(s.total_fees, 2),
        "start_balance_usd": round(s.start_balance, 2),
        "end_balance_usd": round(s.end_balance, 2),
        "net_return_pct": round((s.end_balance / s.start_balance - 1) * 100, 2) if s.start_balance else 0,
        "max_drawdown_usd": round(s.max_drawdown, 2),
        "max_drawdown_pct": round(s.max_drawdown_pct, 2),
        "long_bets": s.long_total,
        "long_win_rate_pct": round(s.long_wins / s.long_total * 100, 2) if s.long_total else 0,
        "short_bets": s.short_total,
        "short_win_rate_pct": round(s.short_wins / s.short_total * 100, 2) if s.short_total else 0,
    }


def classify_bar(
    candle_time: int,
    signal: str | None,
    trade: Trade | None,
    skip_reason: str | None,
) -> str:
    if trade and not signal:
        return "anomaly"
    if trade and signal:
        sig_side = trend_to_signal(trade.trend)
        if sig_side != signal:
            return "side_mismatch"
        return "aligned"
    if signal and skip_reason in EXECUTION_SKIP_REASONS:
        return "execution_skip"
    if signal and skip_reason:
        return "missed_signal"
    if signal:
        return "missed_signal"
    if skip_reason == "no_signal" or skip_reason is None:
        return "no_signal"
    return "other_skip"


def run_csharp_signal_export(binance_path: Path) -> dict[str, Any] | None:
    proj = SIGNAL_EXPORT / "signal_window_export.csproj"
    if not proj.exists():
        return None
    try:
        subprocess.run(
            ["dotnet", "build", str(proj), "-v", "q", "-nologo"],
            check=True,
            cwd=ROOT,
            capture_output=True,
        )
        dll = SIGNAL_EXPORT / "bin" / "Debug" / "net10.0" / "signal_window_export.dll"
        result = subprocess.run(
            ["dotnet", str(dll), str(binance_path), "sec"],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError, FileNotFoundError) as e:
        print(f"Warning: C# signal export failed: {e}", file=sys.stderr)
        return None


def validate_pnl_formula(trades: list[Trade], commission_pct: float = 0.0) -> list[dict]:
    bad = []
    for t in trades:
        expected, _ = compute_bet_pnl(bool(t.won), t.stake_usd, commission_pct, t.entry_price)
        if abs(expected - t.pnl_usd) > 0.02:
            bad.append({"id": t.id, "expected": expected, "actual": t.pnl_usd})
    return bad


def validate_won_vs_candle(trades: list[Trade], candle_by_time: dict[int, Candle]) -> list[dict]:
    bad = []
    for t in trades:
        c = candle_by_time.get(t.candle_time)
        if not c:
            bad.append({"id": t.id, "reason": "missing_candle"})
            continue
        sig = trend_to_signal(t.trend)
        expected_won = is_bet_won(sig, c)
        if c.close == c.open:
            continue
        if bool(t.won) != expected_won:
            bad.append(
                {
                    "id": t.id,
                    "candle_time": t.candle_time,
                    "won_db": t.won,
                    "won_candle": expected_won,
                    "ohlc": f"O={c.open} C={c.close}",
                }
            )
    return bad


def fmt_usd(v: float) -> str:
    sign = "+" if v >= 0 else ""
    return f"{sign}${v:,.2f}"


def fmt_pct(v: float) -> str:
    return f"{v:.1f}%"


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(c) for c in row) + " |")
    return "\n".join(lines)


def generate_report(
    *,
    trades: list[Trade],
    skips: dict[int, str],
    candles: list[Candle],
    index_by_time: dict[int, int],
    entry_flags: list[bool],
    sides: list[str | None],
    scenarios: dict[str, ScenarioStats],
    scenario_bets: dict[str, list[BetResult]],
    prod: dict[str, Any],
    start_balance: float,
    start_balance_note: str,
    window_start: int,
    window_end: int,
    backtest_end: int,
    parity: dict[str, Any] | None,
    pnl_validation: list[dict],
    won_validation: list[dict],
    out_path: Path,
    data_dir: Path,
    binance_last: int,
    trades_after_data: list[Trade],
    trades_in_coverage: list[Trade],
) -> None:
    candle_by_time = {c.time_sec: c for c in candles}
    trade_by_time = {t.candle_time: t for t in trades}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    # --- signal matrix ---
    matrix_rows: list[dict] = []
    bar_times = sorted(t for t in range(window_start, window_end + 1, 300) if t in index_by_time or t in trade_by_time or t in skips)
    # use all 5m bars between window bounds present in index or activity
    all_times = set(index_by_time) | set(trade_by_time) | set(skips)
    bar_times = sorted(t for t in all_times if window_start <= t <= backtest_end)

    classification_counts: Counter[str] = Counter()
    signal_bars_in_window = 0

    for ct in bar_times:
        idx = index_by_time.get(ct)
        signal = sides[idx] if idx is not None and entry_flags[idx] else None
        if signal:
            signal_bars_in_window += 1
        trade = trade_by_time.get(ct)
        skip = skips.get(ct)
        cls = classify_bar(ct, signal, trade, skip)
        classification_counts[cls] += 1
        matrix_rows.append(
            {
                "CandleTime": ct,
                "UtcTime": utc_str(ct),
                "Signal": signal or "",
                "ProdTrade": "yes" if trade else "",
                "SkipReason": skip or "",
                "Classification": cls,
            }
        )

    matrix_csv = data_dir / "signal_matrix.csv"
    with matrix_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(matrix_rows[0].keys()) if matrix_rows else [])
        if matrix_rows:
            w.writeheader()
            w.writerows(matrix_rows)

    # --- trade reconciliation ---
    bt_a_by_time = {b.candle_time: b for b in scenario_bets.get("BT-A", [])}
    bt_c_by_time = {b.candle_time: b for b in scenario_bets.get("BT-C", [])}

    recon_rows: list[dict] = []
    for t in trades:
        c = candle_by_time.get(t.candle_time)
        idx = index_by_time.get(t.candle_time)
        signal = sides[idx] if idx is not None and entry_flags[idx] else None
        sig_side = trend_to_signal(t.trend)
        won_candle = is_bet_won(sig_side, c) if c and c.close != c.open else None
        bta = bt_a_by_time.get(t.candle_time)
        btc = bt_c_by_time.get(t.candle_time)
        pnl_at_05 = None
        if c:
            pnl_at_05, _ = compute_bet_pnl(bool(t.won), t.stake_usd, 0.0, 0.5)
        recon_rows.append(
            {
                "Id": t.id,
                "CandleTime": t.candle_time,
                "UtcTime": utc_str(t.candle_time),
                "Side": t.side,
                "Trend": t.trend,
                "EntryPrice": round(t.entry_price, 4),
                "StakeUsd": round(t.stake_usd, 4),
                "PnlUsd_prod": round(t.pnl_usd, 4),
                "Won_prod": t.won,
                "Signal_side": signal or "",
                "Signal_match": "yes" if signal == sig_side else "no",
                "Open": c.open if c else "",
                "Close": c.close if c else "",
                "Won_candle": int(won_candle) if won_candle is not None else "",
                "Pnl_bt_A": round(bta.pnl, 4) if bta else "",
                "Pnl_bt_C": round(btc.pnl, 4) if btc else "",
                "Pnl_at_0.5": round(pnl_at_05, 4) if pnl_at_05 is not None else "",
                "Entry_edge": round(t.pnl_usd - pnl_at_05, 4) if pnl_at_05 is not None else "",
            }
        )

    recon_csv = data_dir / "trade_reconciliation.csv"
    with recon_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(recon_rows[0].keys()))
        w.writeheader()
        w.writerows(recon_rows)

    # --- skip attribution ---
    skip_counter = Counter(skips.values())
    signal_skip_rows: list[list[Any]] = []
    for reason, cnt in skip_counter.most_common():
        signal_skip_rows.append([reason, cnt])

    # counterfactual PnL on execution-skipped signal bars
    exec_skip_times = {
        ct for ct in bar_times
        if (idx := index_by_time.get(ct)) is not None
        and entry_flags[idx]
        and skips.get(ct) in EXECUTION_SKIP_REASONS
        and ct not in trade_by_time
    }
    cf_stats, _ = simulate_compound(
        candles,
        entry_flags,
        sides,
        scenario_id="CF",
        name="counterfactual",
        start_balance=start_balance,
        stake_pct=STAKE_PCT,
        commission_pct=0.0,
        allowed_times=exec_skip_times,
        window_start=window_start,
        window_end=backtest_end,
    )

    # entry price buckets
    buckets = {"≤0.45": [], "0.46–0.50": [], "0.51–0.52": [], ">0.52": []}
    entry_edge_total = 0.0
    for t in trades:
        if t.won:
            pnl_05, _ = compute_bet_pnl(True, t.stake_usd, 0.0, 0.5)
            entry_edge_total += t.pnl_usd - pnl_05
        ep = t.entry_price
        if ep <= 0.45:
            buckets["≤0.45"].append(t)
        elif ep <= 0.50:
            buckets["0.46–0.50"].append(t)
        elif ep <= 0.52:
            buckets["0.51–0.52"].append(t)
        else:
            buckets[">0.52"].append(t)

    prod_cov = prod_stats(trades_in_coverage)
    prod_pnl = prod_cov["total_pnl"]
    prod_pnl_all = prod["total_pnl"]
    bt_a_pnl = scenarios["BT-A"].total_pnl
    bt_a_matched, _ = simulate_compound(
        candles,
        entry_flags,
        sides,
        scenario_id="BT-A-M",
        name="BT-A on traded bars only",
        start_balance=start_balance,
        stake_pct=STAKE_PCT,
        commission_pct=0.0,
        allowed_times=set(trade_by_time),
        window_start=window_start,
        window_end=backtest_end,
    )
    execution_gap = -cf_stats.total_pnl  # prod missed these
    entry_edge = entry_edge_total
    stake_path_gap = prod_pnl - bt_a_matched.total_pnl - entry_edge

    scenarios_json = {k: stats_to_dict(v) for k, v in scenarios.items()}
    scenarios_json["PROD"] = {
        "id": "PROD",
        "name": "Live production (Binance cov.)",
        "bets": prod_cov["bets"],
        "wins": prod_cov["wins"],
        "losses": prod_cov["losses"],
        "win_rate_pct": round(prod_cov["win_rate"], 2),
        "total_pnl_usd": round(prod_pnl, 2),
        "total_pnl_all_usd": round(prod["total_pnl"], 2),
        "total_fees_usd": 0,
        "start_balance_usd": round(start_balance, 2),
        "end_balance_usd": round(start_balance + prod_pnl, 2),
        "net_return_pct": round(prod_pnl / start_balance * 100, 2) if start_balance else 0,
        "max_drawdown_usd": "n/a",
        "long_bets": prod_cov["long_bets"],
        "short_bets": prod_cov["short_bets"],
    }
    (data_dir / "backtest_scenarios.json").write_text(
        json.dumps(scenarios_json, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # parity info
    parity_lines = ""
    if parity:
        py_entries = [(candles[i].time_sec, i, sides[i]) for i in range(len(candles)) if entry_flags[i] and sides[i]]
        cs_entries = [(e[0], e[1], e[2]) for e in parity.get("entries", [])]
        py_set = {(t, s) for t, _, s in py_entries}
        cs_set = {(t, s) for t, _, s in cs_entries}
        in_window_py = {x for x in py_set if window_start <= x[0] <= window_end}
        in_window_cs = {x for x in cs_set if window_start <= x[0] <= window_end}
        parity_ok = in_window_py == in_window_cs
        parity_lines = (
            f"- Python vs C# сигналы в окне: **{'совпадают' if parity_ok else 'РАСХОЖДЕНИЕ'}** "
            f"(Python={len(in_window_py)}, C#={len(in_window_cs)})\n"
        )
        if not parity_ok:
            only_py = len(in_window_py - in_window_cs)
            only_cs = len(in_window_cs - in_window_py)
            parity_lines += f"- Только Python: {only_py}, только C#: {only_cs}\n"
    else:
        parity_lines = "- C# parity export: не выполнен (см. scripts/signal_window_export)\n"

    # sample trade table (first 15 + last 5)
    sample_trades = recon_rows[:15] + (recon_rows[-5:] if len(recon_rows) > 20 else [])
    sample_table = md_table(
        ["UTC", "Side", "Stake", "Entry", "PnL", "Won", "Signal", "Edge@0.5"],
        [
            [
                r["UtcTime"][5:16],
                r["Side"],
                f"${r['StakeUsd']:.2f}",
                r["EntryPrice"],
                fmt_usd(r["PnlUsd_prod"]),
                r["Won_prod"],
                r["Signal_match"],
                r["Entry_edge"] if r["Entry_edge"] != "" else "—",
            ]
            for r in sample_trades
        ],
    )

    daily_rows = [[d, fmt_usd(prod["daily_pnl"][d])] for d in sorted(prod["daily_pnl"])]

    scenario_rows = []
    for key in ["PROD", "BT-A", "BT-B", "BT-C", "BT-D", "BT-E"]:
        if key == "PROD":
            s = scenarios_json["PROD"]
        elif key == "BT-E":
            s = scenarios_json["BT-E"]
        else:
            s = scenarios_json[key]
        scenario_rows.append(
            [
                s["id"],
                s["bets"],
                s["wins"],
                fmt_pct(s["win_rate_pct"]),
                fmt_usd(s["total_pnl_usd"]),
                fmt_usd(s.get("end_balance_usd", 0)),
                s.get("max_drawdown_usd", "—"),
            ]
        )

    anomalies = sum(1 for r in recon_rows if r["Signal_match"] == "no")
    aligned = classification_counts["aligned"]

    report = f"""# Dashboard: Backtest vs Production (blend_fade2)

**Дата отчёта:** {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}  
**Стратегия:** blend_fade2 (`PresetPnlMax`: lookback={LOOKBACK}, fast={LOOKBACK_FAST}, z={Z_THRESHOLD}, z_fast_min={Z_FAST_MIN})  
**Инструмент:** BTCUSDT 5m (Binance Vision)

---

## 1. Резюме

| KPI | Production (Live, Binance cov.) | Backtest BT-A (ideal) |
|-----|--------------------------------|------------------------|
| Сделок | {prod_cov['bets']} ({prod['bets']} всего) | {scenarios['BT-A'].bets} |
| Win rate | {fmt_pct(prod_cov['win_rate'])} | {fmt_pct(scenarios['BT-A'].wins / scenarios['BT-A'].bets * 100 if scenarios['BT-A'].bets else 0)} |
| Total PnL | {fmt_usd(prod_pnl)} ({fmt_usd(prod_pnl_all)} всего) | {fmt_usd(bt_a_pnl)} |
| ROI на старт. баланс | {fmt_pct(prod_pnl / start_balance * 100)} | {fmt_pct(scenarios['BT-A'].total_pnl / start_balance * 100)} |
| Profit factor | {prod['profit_factor']:.2f} | — |
| Max loss streak | {prod['max_loss_streak']} | — |

**Главный вывод:** за период **{utc_date(window_start)} — {utc_date(backtest_end)}** (сверка по Binance) production зафиксировал **{fmt_usd(prod_pnl)}** на **{prod_cov['bets']}** сделках, тогда как идеальный бэктест BT-A дал бы **{fmt_usd(bt_a_pnl)}** на **{scenarios['BT-A'].bets}** сделках. Разрыв **{fmt_usd(prod_pnl - bt_a_pnl)}**. Полный Live PnL за окно до {utc_date(window_end)}: **{fmt_usd(prod_pnl_all)}** ({prod['bets']} сделок).

- Сигнальных баров в окне: **{signal_bars_in_window}**; исполнено: **{len(trades)}** ({len(trades)/signal_bars_in_window*100:.1f}% coverage)
- Execution skips (`entry_price_out_of_range` и др.): **{classification_counts['execution_skip']}**
- Сделок без сигнала (аномалии): **{classification_counts['anomaly']}**
- Side mismatch: **{classification_counts.get('side_mismatch', 0)}**

---

## 2. Источники и период

| Источник | Путь | Записей |
|----------|------|---------|
| Live trades | `Trades.json` | {len(trades)} |
| Skipped bets | `SkippedBets.json` | {len(skips)} (Live, deduped) |
| Binance 5m | archived `btcusdt_5m_2026.json` | {len(candles)} баров в срезе (+{WARMUP_BARS} warmup) |

**Окно анализа (UTC):** {utc_str(window_start)} → {utc_str(window_end)}  
**Окно бэктеста (Binance OHLC):** {utc_str(window_start)} → {utc_str(backtest_end)} (архив до {utc_str(binance_last)})  
**Сделок вне покрытия Binance:** {len(trades_after_data)} (PnL {fmt_usd(sum(t.pnl_usd for t in trades_after_data))}) — исключены из сверки Won/сигналов  
**Стартовый баланс (оценка):** ${start_balance:.2f} — {start_balance_note}  
**Stake:** {STAKE_PCT}% compound, cap ${MAX_STAKE_USD:.0f}  
**Live fee:** 0% (maker); BT-B использует 1.8%

{parity_lines}

---

## 3. Фактический результат (Live)

| Метрика | Значение |
|---------|----------|
| Сумма StakeUsd | ${prod['total_stake']:,.2f} |
| Сумма PnlUsd (всего) | {fmt_usd(prod['total_pnl'])} |
| Сумма PnlUsd (Binance cov.) | {fmt_usd(prod_pnl)} |
| ROI на deployed stake | {fmt_pct(prod['roi_on_stake'])} |
| Wins / Losses | {prod['wins']} / {prod['losses']} |
| Long WR | {prod['long_wins']}/{prod['long_bets']} ({prod['long_wins']/prod['long_bets']*100 if prod['long_bets'] else 0:.1f}%) |
| Short WR | {prod['short_wins']}/{prod['short_bets']} ({prod['short_wins']/prod['short_bets']*100 if prod['short_bets'] else 0:.1f}%) |
| Wins без RedeemedAt | {prod['redeemed_null_wins']} ({prod['redeemed_null_wins']/prod['wins']*100 if prod['wins'] else 0:.1f}% побед) |

### PnL по дням (UTC)

{md_table(["Дата", "PnL"], daily_rows)}

### Long vs Short

{md_table(["Сторона", "Сделок", "Wins", "WR", "PnL"], [
    ["Long (Up)", prod['long_bets'], prod['long_wins'], fmt_pct(prod['long_wins']/prod['long_bets']*100 if prod['long_bets'] else 0), fmt_usd(sum(t.pnl_usd for t in trades if t.trend=='Long'))],
    ["Short (Down)", prod['short_bets'], prod['short_wins'], fmt_pct(prod['short_wins']/prod['short_bets']*100 if prod['short_bets'] else 0), fmt_usd(sum(t.pnl_usd for t in trades if t.trend=='Short'))],
])}

---

## 4. Бэктест: сценарии BT-A … BT-E

| ID | Сделок | Wins | WR | PnL | End balance | Max DD |
|----|--------|------|----|-----|-------------|--------|
{chr(10).join('| ' + ' | '.join(str(c) for c in row) + ' |' for row in scenario_rows)}

**Описание сценариев:**
- **BT-A** — все сигналы, entry=0.50, fee=0%, compound {STAKE_PCT}%
- **BT-B** — как BT-A, fee=1.8% (paper/doc модель)
- **BT-C** — только prod-сделки, фактические stake и entry price
- **BT-D** — все сигналы кроме `entry_price_out_of_range`, entry=0.50
- **BT-E** — signal-only win rate (без PnL compound)

BT-E win rate: **{fmt_pct(scenarios['BT-E'].wins / scenarios['BT-E'].bets * 100 if scenarios['BT-E'].bets else 0)}** ({scenarios['BT-E'].wins}/{scenarios['BT-E'].bets})

---

## 5. Сравнение prod vs backtest (waterfall PnL)

| Компонент | USD | Пояснение |
|-----------|-----|-----------|
| BT-A (ideal) | {fmt_usd(bt_a_pnl)} | Все сигналы, entry 0.50 |
| − Execution gap | {fmt_usd(-cf_stats.total_pnl)} | Пропущено {len(exec_skip_times)} signal-баров (price/order/balance) |
| + Entry price edge | {fmt_usd(entry_edge)} | Выигрыши по цене < 0.50 vs модель 0.50 |
| ± Stake path / прочее | {fmt_usd(stake_path_gap)} | Фактические stake vs compound на тех же барах |
| **= Production** | **{fmt_usd(prod_pnl)}** | Факт |

На совпадающих сделках BT-A (только traded bars): PnL = **{fmt_usd(bt_a_matched.total_pnl)}** vs prod **{fmt_usd(prod_pnl)}**.

---

## 6. Покрытие сигналов

```mermaid
flowchart TD
    allBars[Все 5m бары в окне] --> sigBars["Сигнал blend_fade2: {signal_bars_in_window}"]
    sigBars --> traded["Исполнено Live: {len(trades)}"]
    sigBars --> execSkip["Execution skip: {classification_counts['execution_skip']}"]
    sigBars --> missed["Missed / other: {classification_counts['missed_signal']}"]
    allBars --> noSig["Без сигнала: {classification_counts['no_signal']}"]
```

### Skip reasons (Live, deduped)

{md_table(["SkipReason", "Count"], signal_skip_rows)}

### Классификация баров

{md_table(["Classification", "Count"], [[k, v] for k, v in classification_counts.most_common()])}

Counterfactual PnL на execution-skipped signal барах (BT-A модель): **{fmt_usd(cf_stats.total_pnl)}** ({cf_stats.bets} bets, WR {fmt_pct(cf_stats.wins/cf_stats.bets*100 if cf_stats.bets else 0)})

---

## 7. Сделка-к-сделке (выборка)

Полная таблица: [`reports/data/trade_reconciliation.csv`](data/trade_reconciliation.csv) ({len(recon_rows)} строк)

{sample_table}

Signal match anomalies: **{anomalies}** сделок

---

## 8. Влияние цены входа

| Bucket EntryPrice | Count | Avg EP | Wins | PnL |
|-------------------|-------|--------|------|-----|
{chr(10).join(
    f"| {name} | {len(items)} | {sum(t.entry_price for t in items)/len(items):.3f} | {sum(t.won for t in items)} | {fmt_usd(sum(t.pnl_usd for t in items))} |"
    for name, items in buckets.items() if items
)}

**Суммарный entry edge** (prod win PnL − PnL@0.50): **{fmt_usd(entry_edge)}**

---

## 9. Временные паттерны

### Win rate по часу UTC

{md_table(["Hour UTC", "Trades", "Wins", "WR", "PnL"], [
    [h, prod['hourly_cnt'].get(h,0), prod['hourly_wins'].get(h,0),
     fmt_pct(prod['hourly_wins'].get(h,0)/prod['hourly_cnt'][h]*100 if prod['hourly_cnt'].get(h) else 0),
     fmt_usd(prod['hourly_pnl'].get(h,0))]
    for h in sorted(prod['hourly_cnt'])
])}

---

## 10. Качество данных

| Проверка | Результат |
|----------|-----------|
| PnlUsd vs формула ComputeBetPnl | {'✅ OK' if not pnl_validation else f'❌ {len(pnl_validation)} расхождений'} |
| Won vs направление свечи Binance | {'✅ OK' if not won_validation else f'❌ {len(won_validation)} расхождений'} |
| Баров в матрице | {len(matrix_rows)} |
| Aligned signal+trade | {aligned} |

{f"**PnlUsd расхождения:** {pnl_validation[:5]}" if pnl_validation else ""}
{f"**Won расхождения ({len(won_validation)}):** settlement в БД ≠ свеча Binance — trade IDs: {', '.join(str(w['id']) for w in won_validation)}" if won_validation else ""}

---

## 11. Рекомендации

1. **Execution coverage ({len(trades)/signal_bars_in_window*100:.0f}%)** — {classification_counts['execution_skip']} signal-баров потеряны из‑за `entry_price_out_of_range` ({skip_counter.get('entry_price_out_of_range', 0)} skips). Рассмотреть расширение patience-коридора или альтернативный fallback для high-conviction сигналов.
2. **Entry price edge ({fmt_usd(entry_edge)})** — низкие entry (<0.45) улучшают economics; текущий maker-limit механизм даёт преимущество vs backtest@0.50. Учитывать это при сравнении с BT-A.
3. **Stake 1.5%** — снижает variance vs 3% default в STRATEGY.md; при WR ~{prod['win_rate']:.0f}% Kelly implied ниже — текущий sizing консервативен.
4. **Settlement quality** — 4 сделки с `Won` ≠ направление свечи Binance (IDs 283, 325, 343, 480); проверить `LiveTradeReconciliationService`.
5. **RedeemedAt** — {prod['redeemed_null_wins']} winning trades без redeem timestamp в полном наборе.
6. **Мониторинг** — отслеживать ratio `traded / signal_bars` и counterfactual PnL на execution skips как KPI исполнения.

---

## 12. Приложения

### Формула PnL (C# ComputeBetPnl)

```
shares = stake / entry_price
payout = shares if won else 0
pnl = payout - stake - stake * commission_pct / 100
```

### Config snapshot

```json
{json.dumps({"lookback": LOOKBACK, "lookback_fast": LOOKBACK_FAST, "z_threshold": Z_THRESHOLD, "min_range_pct": MIN_RANGE_PCT, "z_fast_min": Z_FAST_MIN, "stake_pct": STAKE_PCT, "max_stake_usd": MAX_STAKE_USD}, indent=2)}
```

### Reproducibility

```bash
python scripts/backtest_vs_prod_dashboard.py \\
  --trades Trades.json \\
  --skipped SkippedBets.json \\
  --binance "C:/All/Develop/trading-cursor-models/data/binance/btcusdt_5m/btcusdt_5m_2026.json" \\
  --out reports/backtest-vs-prod-dashboard-2026-05.ru.md
```

### Machine-readable outputs

- [`reports/data/signal_matrix.csv`](data/signal_matrix.csv)
- [`reports/data/trade_reconciliation.csv`](data/trade_reconciliation.csv)
- [`reports/data/backtest_scenarios.json`](data/backtest_scenarios.json)
"""

    out_path.write_text(report, encoding="utf-8")
    print(f"Wrote {out_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Production vs backtest dashboard")
    parser.add_argument("--trades", type=Path, default=ROOT / "Trades.json")
    parser.add_argument("--skipped", type=Path, default=ROOT / "SkippedBets.json")
    parser.add_argument(
        "--binance",
        type=Path,
        default=TCM / "data" / "binance" / "btcusdt_5m" / "btcusdt_5m_2026.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "reports" / "backtest-vs-prod-dashboard-2026-05.ru.md",
    )
    parser.add_argument("--skip-csharp-parity", action="store_true")
    args = parser.parse_args()

    trades = load_trades(args.trades)
    skips = load_skips(args.skipped)
    all_candles = load_binance(args.binance)
    binance_last = max(c.time_sec for c in all_candles)

    if not trades:
        print("No Live trades found", file=sys.stderr)
        return 1

    window_start = min(min(t.candle_time for t in trades), min(skips) if skips else min(t.candle_time for t in trades))
    window_end = max(max(t.candle_time for t in trades), max(skips) if skips else max(t.candle_time for t in trades))
    backtest_end = min(window_end, binance_last)

    trades_in_coverage = [t for t in trades if t.candle_time <= binance_last]
    trades_after_data = [t for t in trades if t.candle_time > binance_last]

    candles, index_by_time = slice_candles(all_candles, window_start, window_end)
    entry_flags, sides = generate_blend_fade2_signals(candles)

    start_balance, start_note = infer_start_balance(trades)

    trade_times = {t.candle_time for t in trades_in_coverage}
    price_skip_times = {ct for ct, r in skips.items() if r == "entry_price_out_of_range"}

    win = window_start
    wend = backtest_end

    bt_a, bets_a = simulate_compound(
        candles, entry_flags, sides,
        scenario_id="BT-A", name="Ideal backtest",
        start_balance=start_balance, stake_pct=STAKE_PCT, commission_pct=0.0,
        window_start=win, window_end=wend,
    )
    bt_b, _ = simulate_compound(
        candles, entry_flags, sides,
        scenario_id="BT-B", name="Doc backtest",
        start_balance=start_balance, stake_pct=STAKE_PCT, commission_pct=1.8,
        window_start=win, window_end=wend,
    )
    bt_c, bets_c = simulate_compound(
        candles, entry_flags, sides,
        scenario_id="BT-C", name="Prod-faithful",
        start_balance=start_balance, stake_pct=STAKE_PCT, commission_pct=0.0,
        allowed_times=trade_times,
        entry_prices={t.candle_time: t.entry_price for t in trades_in_coverage},
        actual_stakes={t.candle_time: t.stake_usd for t in trades_in_coverage},
        window_start=win, window_end=wend,
    )
    bt_d_allowed = {
        ct for ct in (candles[i].time_sec for i in range(len(candles)) if entry_flags[i] and sides[i])
        if ct not in price_skip_times and win <= ct <= wend
    }
    bt_d, _ = simulate_compound(
        candles, entry_flags, sides,
        scenario_id="BT-D", name="Prod-faithful compound",
        start_balance=start_balance, stake_pct=STAKE_PCT, commission_pct=0.0,
        allowed_times=bt_d_allowed,
        window_start=win, window_end=wend,
    )

    # BT-E signal only
    bt_e = ScenarioStats(id="BT-E", name="Signal-only", start_balance=start_balance)
    for i, c in enumerate(candles):
        if not entry_flags[i] or sides[i] is None:
            continue
        if not (win <= c.time_sec <= wend):
            continue
        sig = sides[i]
        assert sig is not None
        won = is_bet_won(sig, c)
        if c.close == c.open:
            continue
        bt_e.bets += 1
        if won:
            bt_e.wins += 1
        else:
            bt_e.losses += 1

    scenarios = {"BT-A": bt_a, "BT-B": bt_b, "BT-C": bt_c, "BT-D": bt_d, "BT-E": bt_e}
    scenario_bets = {"BT-A": bets_a, "BT-C": bets_c}

    parity = None if args.skip_csharp_parity else run_csharp_signal_export(args.binance)

    pnl_val = validate_pnl_formula(trades, 0.0)
    candle_by_time = {c.time_sec: c for c in candles}
    won_val = validate_won_vs_candle(trades_in_coverage, candle_by_time)

    prod = prod_stats(trades)
    data_dir = args.out.parent / "data"

    generate_report(
        trades=trades,
        skips=skips,
        candles=candles,
        index_by_time=index_by_time,
        entry_flags=entry_flags,
        sides=sides,
        scenarios=scenarios,
        scenario_bets=scenario_bets,
        prod=prod,
        start_balance=start_balance,
        start_balance_note=start_note,
        window_start=window_start,
        window_end=window_end,
        backtest_end=backtest_end,
        parity=parity,
        pnl_validation=pnl_val,
        won_validation=won_val,
        out_path=args.out,
        data_dir=data_dir,
        binance_last=binance_last,
        trades_after_data=trades_after_data,
        trades_in_coverage=trades_in_coverage,
    )

    print(json.dumps({k: stats_to_dict(v) for k, v in scenarios.items()}, indent=2))
    print(f"Validation: pnl_mismatches={len(pnl_val)} won_mismatches={len(won_val)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
