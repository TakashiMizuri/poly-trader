using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

public sealed class BosFlowSignalArrays
{
    public IReadOnlyList<bool> EntryBar { get; init; } = [];
    public IReadOnlyList<MarketTrend?> Side { get; init; } = [];
}

/// <summary>
/// BoS flow signal generator (1:1 with trading-cursor-models strategies/bos_flow/signals.py).
/// Decision at open[i] using only bars [0..i-1] and open[i] timestamp for session gate.
/// </summary>
public static class BosFlowSignals
{
    private const int MaxSwings = 60;

    public static BosFlowSignalArrays Generate(
        IReadOnlyList<ChartCandle> candles,
        BosFlowConfig? config = null)
    {
        var cfg = config ?? BosFlowConfig.Default;
        var n = candles.Count;
        var entry = new bool[n];
        var side = new MarketTrend?[n];

        var opens = candles.Select(c => c.Open).ToArray();
        var highs = candles.Select(c => c.High).ToArray();
        var lows = candles.Select(c => c.Low).ToArray();
        var closes = candles.Select(c => c.Close).ToArray();
        var openTimesMs = candles.Select(c => c.Time).ToArray();

        var emaVals = StructureMath.Ema(closes, cfg.EmaPeriod);
        var rsiVals = cfg.UseRsiGate
            ? StructureMath.Rsi(closes, cfg.RsiPeriod)
            : new double?[n];

        var swingHighs = new List<double>();
        var swingLows = new List<double>();
        string? bias = null;
        var biasAge = 0;
        var left = cfg.SwingLeft;
        var right = cfg.SwingRight;

        for (var i = 0; i < n; i++)
        {
            var confirmIdx = i - right;
            if (confirmIdx >= left)
            {
                if (StructureMath.ConfirmSwingHigh(highs, confirmIdx, left, right))
                {
                    swingHighs.Add(highs[confirmIdx]);
                    if (swingHighs.Count > MaxSwings)
                    {
                        swingHighs.RemoveAt(0);
                    }
                }

                if (StructureMath.ConfirmSwingLow(lows, confirmIdx, left, right))
                {
                    swingLows.Add(lows[confirmIdx]);
                    if (swingLows.Count > MaxSwings)
                    {
                        swingLows.RemoveAt(0);
                    }
                }
            }

            var closed = i - 1;
            if (closed < 1)
            {
                continue;
            }

            var cClose = closes[closed];
            var cOpen = opens[closed];

            if (swingHighs.Count > 0 &&
                cClose > swingHighs[^1] * (1 + cfg.MinBreakPct))
            {
                bias = "long";
                biasAge = 0;
            }
            else if (swingLows.Count > 0 &&
                     cClose < swingLows[^1] * (1 - cfg.MinBreakPct))
            {
                bias = "short";
                biasAge = 0;
            }
            else if (bias != null)
            {
                biasAge++;
                if (biasAge > cfg.MaxBiasBars)
                {
                    bias = null;
                }
            }

            if (bias == null || !SessionOk(openTimesMs[i], cfg))
            {
                continue;
            }

            var rng = highs[closed] - lows[closed];
            if (rng <= 0)
            {
                continue;
            }

            var bodyRatio = Math.Abs(cClose - cOpen) / rng;
            if (bodyRatio < cfg.MinBodyRatio)
            {
                continue;
            }

            var e = emaVals[closed];
            var signalSide = bias;
            if (cfg.FadeBos)
            {
                signalSide = bias == "long" ? "short" : "long";
            }

            if (signalSide == "long")
            {
                if (!cfg.AllowLong)
                {
                    continue;
                }

                if (!cfg.FadeBos && cClose <= cOpen)
                {
                    continue;
                }

                if (e is not null && (cfg.FadeBos ? cClose >= e : cClose <= e))
                {
                    continue;
                }

                var rv = rsiVals[closed];
                if (rv is not null && rv < cfg.RsiLongMin)
                {
                    continue;
                }

                entry[i] = true;
                side[i] = MarketTrend.Long;
            }
            else
            {
                if (!cfg.AllowShort)
                {
                    continue;
                }

                if (!cfg.FadeBos && cClose >= cOpen)
                {
                    continue;
                }

                if (e is not null && (cfg.FadeBos ? cClose <= e : cClose >= e))
                {
                    continue;
                }

                var rv = rsiVals[closed];
                if (rv is not null && rv > cfg.RsiShortMax)
                {
                    continue;
                }

                entry[i] = true;
                side[i] = MarketTrend.Short;
            }
        }

        return new BosFlowSignalArrays
        {
            EntryBar = entry,
            Side = side,
        };
    }

    /// <summary>Signal for bar at <paramref name="index"/>; optional next-bar open time for live entry.</summary>
    public static MarketTrend? ResolveAtOpen(
        int index,
        IReadOnlyList<ChartCandle> candles,
        BosFlowConfig? config = null,
        long? nextBarOpenTimeMs = null)
    {
        if (index < 0)
        {
            return null;
        }

        if (index < candles.Count)
        {
            var signals = Generate(candles, config);
            return signals.EntryBar[index] ? signals.Side[index] : null;
        }

        if (nextBarOpenTimeMs is null || candles.Count == 0)
        {
            return null;
        }

        var anchor = candles[^1];
        var extended = candles.ToList();
        extended.Add(new ChartCandle
        {
            Time = nextBarOpenTimeMs.Value,
            Open = anchor.Close,
            High = anchor.Close,
            Low = anchor.Close,
            Close = anchor.Close,
        });

        var nextSignals = Generate(extended, config);
        return nextSignals.EntryBar[index] ? nextSignals.Side[index] : null;
    }

    private static bool SessionOk(long openTimeUnix, BosFlowConfig cfg)
    {
        var start = cfg.SessionUtcStart;
        var end = cfg.SessionUtcEnd;
        if (start is null || end is null)
        {
            return true;
        }

        // ChartCandle.Time is unix seconds; tolerate ms timestamps if passed.
        var hour = openTimeUnix > 1_000_000_000_000L
            ? (int)((openTimeUnix / 1000 / 3600) % 24)
            : (int)((openTimeUnix / 3600) % 24);
        if (start <= end)
        {
            return hour >= start && hour < end;
        }

        return hour >= start || hour < end;
    }
}
