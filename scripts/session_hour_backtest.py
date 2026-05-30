#!/usr/bin/env python3
"""Hourly UTC session backtest for blend_fade2 on Binance BTCUSDT 5m (2020–2026)."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(r"C:\All\Develop\trading-cursor-models\data\binance\btcusdt_5m")
REPORT_PATH = ROOT / "reports" / "session-hour-backtest-btc-2020-2026.ru.md"

LOOKBACK = 48
LOOKBACK_FAST = 18
Z_THRESHOLD = 1.08
MIN_RANGE_PCT = 0.0026
Z_FAST_MIN = 0.60

STAKE_PCT = 1.5
MAX_STAKE_USD = 500.0
BALANCE_FLOOR = 0.01
MIN_BET_STAKE = 0.01
START_BALANCE = 100.0
ENTRY_PRICE = 0.50
COMMISSION_PCT = 0.0
WARMUP_BARS = 72

MIN_BETS_FOR_FILTER = 200
BREAKEVEN_WR = ENTRY_PRICE
WR_MARGIN = 0.02


@dataclass
class Candle:
    time_sec: int
    open: float
    high: float
    low: float
    close: float


@dataclass
class HourStats:
    hour: int
    bets: int = 0
    wins: int = 0
    pnl: float = 0.0

    @property
    def win_rate(self) -> float:
        return self.wins / self.bets if self.bets else 0.0


@dataclass
class SimResult:
    bets: int = 0
    wins: int = 0
    total_pnl: float = 0.0
    end_balance: float = START_BALANCE
    hourly: dict[int, HourStats] = field(default_factory=dict)


def utc_hour(ts_sec: int) -> int:
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc).hour


def compute_bet_pnl(won: bool, stake: float) -> float:
    shares = stake / ENTRY_PRICE
    payout = shares if won else 0.0
    return payout - stake


def resolve_stake(balance: float) -> float | None:
    requested = min(balance * STAKE_PCT / 100, MAX_STAKE_USD)
    stake = min(requested, balance - BALANCE_FLOOR)
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


def load_year(path: Path) -> list[Candle]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return sorted(
        [
            Candle(
                time_sec=int(k["open_time"]) // 1000,
                open=float(k["open"]),
                high=float(k["high"]),
                low=float(k["low"]),
                close=float(k["close"]),
            )
            for k in payload["klines"]
        ],
        key=lambda c: c.time_sec,
    )


def load_candles(years: range) -> list[Candle]:
    candles: list[Candle] = []
    for year in years:
        path = DATA_DIR / f"btcusdt_5m_{year}.json"
        if not path.exists():
            print(f"skip missing {path}")
            continue
        candles.extend(load_year(path))
    candles.sort(key=lambda c: c.time_sec)
    # dedupe by time
    deduped: list[Candle] = []
    seen: set[int] = set()
    for c in candles:
        if c.time_sec in seen:
            continue
        seen.add(c.time_sec)
        deduped.append(c)
    return deduped


def simulate(
    candles: list[Candle],
    entry_flags: list[bool],
    sides: list[str | None],
    *,
    excluded_hours: set[int] | None = None,
) -> SimResult:
    result = SimResult()
    balance = START_BALANCE

    for i, candle in enumerate(candles):
        if not entry_flags[i]:
            continue
        side = sides[i]
        if side is None:
            continue
        hour = utc_hour(candle.time_sec)
        if excluded_hours and hour in excluded_hours:
            continue

        stake = resolve_stake(balance)
        if stake is None:
            continue

        won = is_bet_won(side, candle)
        pnl = compute_bet_pnl(won, stake)
        balance = clamp_balance(balance + pnl)

        result.bets += 1
        result.wins += int(won)
        result.total_pnl += pnl
        if hour not in result.hourly:
            result.hourly[hour] = HourStats(hour=hour)
        hs = result.hourly[hour]
        hs.bets += 1
        hs.wins += int(won)
        hs.pnl += pnl

    result.end_balance = balance
    return result


def fmt_usd(v: float) -> str:
    sign = "+" if v >= 0 else "-"
    return f"{sign}${abs(v):,.2f}"


def fmt_pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def identify_bad_hours(hourly: dict[int, HourStats]) -> set[int]:
    bad: set[int] = set()
    for hour in range(24):
        hs = hourly.get(hour, HourStats(hour=hour))
        if hs.bets < MIN_BETS_FOR_FILTER:
            continue
        if hs.pnl < 0 and hs.win_rate < BREAKEVEN_WR - WR_MARGIN:
            bad.add(hour)
        elif hs.pnl < 0 and hs.bets >= MIN_BETS_FOR_FILTER * 2:
            bad.add(hour)
    return bad


def build_report(
    baseline: SimResult,
    filtered: SimResult,
    bad_hours: set[int],
    candle_count: int,
) -> str:
    total_pnl = baseline.total_pnl
    lines = [
        "# Session-hour backtest BTCUSDT 5m (2020–2026)",
        "",
        "Стратегия: **blend_fade2 (PresetPnlMax)**, BT-A: compound 1.5%, entry 0.50, fee 0%.",
        "",
        f"- Свечей в выборке: **{candle_count:,}**",
        f"- Стартовый баланс: **${START_BALANCE:.2f}**",
        f"- Порог «плохого часа»: bets ≥ {MIN_BETS_FOR_FILTER}, PnL < 0 и WR < {fmt_pct(BREAKEVEN_WR - WR_MARGIN)}",
        "",
        "> **Важно:** краткосрочные prod-паттерны (например 03:00 UTC за 4 дня) могут не пройти многолетний тест значимости.",
        "",
        "## Baseline (все часы UTC)",
        "",
        f"| Метрика | Значение |",
        f"|---------|----------|",
        f"| Сделок | {baseline.bets:,} |",
        f"| Win rate | {fmt_pct(baseline.wins / baseline.bets if baseline.bets else 0)} |",
        f"| Net PnL | {fmt_usd(baseline.total_pnl)} |",
        f"| Конечный баланс | ${baseline.end_balance:,.2f} |",
        "",
        "## По часам UTC (baseline)",
        "",
        "| Час | Bets | WR | PnL | Доля PnL |",
        "|-----|------|----|-----|----------|",
    ]

    for hour in range(24):
        hs = baseline.hourly.get(hour, HourStats(hour=hour))
        share = (hs.pnl / total_pnl * 100) if total_pnl else 0.0
        flag = " ⚠" if hour in bad_hours else ""
        lines.append(
            f"| {hour:02d}:00 | {hs.bets:,} | {fmt_pct(hs.win_rate)} | {fmt_usd(hs.pnl)} | {share:+.1f}%{flag} |"
        )

    lines.extend(
        [
            "",
            f"## Фильтр: исключить часы {sorted(bad_hours) if bad_hours else '—'}",
            "",
            f"| Метрика | Baseline | Filtered | Δ |",
            f"|---------|----------|----------|---|",
            f"| Сделок | {baseline.bets:,} | {filtered.bets:,} | {filtered.bets - baseline.bets:+,} |",
            f"| Win rate | {fmt_pct(baseline.wins / baseline.bets if baseline.bets else 0)} | "
            f"{fmt_pct(filtered.wins / filtered.bets if filtered.bets else 0)} | — |",
            f"| Net PnL | {fmt_usd(baseline.total_pnl)} | {fmt_usd(filtered.total_pnl)} | "
            f"{fmt_usd(filtered.total_pnl - baseline.total_pnl)} |",
            f"| Конечный баланс | ${baseline.end_balance:,.2f} | ${filtered.end_balance:,.2f} | "
            f"{fmt_usd(filtered.end_balance - baseline.end_balance)} |",
            "",
            "## Рекомендация",
            "",
        ]
    )

    if not bad_hours:
        lines.append(
            "По заданным порогам **нет устойчиво «плохих» UTC-часов** — "
            "**не включать** hour-filter в prod без дополнительного анализа."
        )
    elif filtered.total_pnl > baseline.total_pnl * 1.05:
        lines.append(
            f"Исключение часов {sorted(bad_hours)} улучшает backtest PnL >5%. "
            "Рассмотреть paper-тест фильтра, но prod 4-дневные наблюдения могли быть шумом."
        )
    else:
        lines.append(
            f"Исключение часов {sorted(bad_hours)} **не даёт** существенного улучшения — "
            "**не включать** hour-filter в prod."
        )

    lines.append("")
    lines.append(f"_Сгенерировано: {datetime.now(tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_")
    return "\n".join(lines)


def main() -> None:
    candles = load_candles(range(2020, 2027))
    if len(candles) < WARMUP_BARS + 10:
        raise SystemExit("Not enough candle data")

    entry_flags, sides = generate_blend_fade2_signals(candles)
    baseline = simulate(candles, entry_flags, sides)
    bad_hours = identify_bad_hours(baseline.hourly)
    filtered = simulate(candles, entry_flags, sides, excluded_hours=bad_hours)

    report = build_report(baseline, filtered, bad_hours, len(candles))
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Wrote {REPORT_PATH}")
    print(f"Baseline: {baseline.bets} bets, PnL {fmt_usd(baseline.total_pnl)}")
    print(f"Bad hours: {sorted(bad_hours)}")
    print(f"Filtered PnL: {fmt_usd(filtered.total_pnl)}")


if __name__ == "__main__":
    main()
