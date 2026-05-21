using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

public sealed class BlendFade2SignalArrays
{
    public IReadOnlyList<bool> EntryBar { get; init; } = [];
    public IReadOnlyList<MarketTrend?> Side { get; init; } = [];
}

/// <summary>
/// Blend fade 2 signal generator (1:1 with trading-cursor-models strategies/blend_fade2/signals.py).
/// Decision at open[i] using only bars [0..i-1] and open[i] timestamp for session gate.
/// </summary>
public static class BlendFade2Signals
{
    public static BlendFade2SignalArrays Generate(
        IReadOnlyList<ChartCandle> candles,
        BlendFade2Config? config = null)
    {
        var cfg = config ?? BlendFade2Config.Default;
        var n = candles.Count;
        var entry = new bool[n];
        var side = new MarketTrend?[n];

        var closes = candles.Select(c => c.Close).ToArray();
        var openTimes = candles.Select(c => c.Time).ToArray();

        var lb = cfg.Lookback;
        var lbF = cfg.LookbackFast;
        var zTh = cfg.ZThreshold;

        for (var i = 1; i < n; i++)
        {
            if (!SessionOk(openTimes[i], cfg))
            {
                continue;
            }

            var closed = i - 1;
            if (closed < Math.Max(lb, lbF) + 1)
            {
                continue;
            }

            var z = ZScore(closes, closed, lb);
            if (z is null)
            {
                continue;
            }

            if (cfg.MinRangePct > 0 && closed >= lb)
            {
                var windowStart = closed - lb;
                var refPrice = closes[windowStart];
                if (refPrice > 0)
                {
                    var windowMax = closes[windowStart];
                    var windowMin = closes[windowStart];
                    for (var j = windowStart; j <= closed; j++)
                    {
                        windowMax = Math.Max(windowMax, closes[j]);
                        windowMin = Math.Min(windowMin, closes[j]);
                    }

                    var move = (windowMax - windowMin) / refPrice;
                    if (move < cfg.MinRangePct)
                    {
                        continue;
                    }
                }
            }

            string? signalSide = null;
            if (z > zTh)
            {
                signalSide = "short";
            }
            else if (z < -zTh)
            {
                signalSide = "long";
            }

            if (signalSide is null)
            {
                continue;
            }

            if (cfg.ZMax > 0)
            {
                if (signalSide == "short" && z > cfg.ZMax)
                {
                    continue;
                }

                if (signalSide == "long" && z < -cfg.ZMax)
                {
                    continue;
                }
            }

            if (cfg.ZReversal)
            {
                var zPrev = ZScore(closes, closed - 1, lb);
                if (zPrev is null)
                {
                    continue;
                }

                if (signalSide == "short" && z >= zPrev)
                {
                    continue;
                }

                if (signalSide == "long" && z <= zPrev)
                {
                    continue;
                }
            }

            if (cfg.ZFastMin > 0)
            {
                var zFast = ZScore(closes, closed, lbF);
                if (zFast is null)
                {
                    continue;
                }

                if (signalSide == "short" && zFast < cfg.ZFastMin)
                {
                    continue;
                }

                if (signalSide == "long" && zFast > -cfg.ZFastMin)
                {
                    continue;
                }
            }

            if (cfg.RankConfirm > 0)
            {
                var rank = PercentileRank(closes, closed, lb);
                if (rank is null)
                {
                    continue;
                }

                if (signalSide == "short" && rank < cfg.RankConfirm)
                {
                    continue;
                }

                if (signalSide == "long" && rank > 1.0 - cfg.RankConfirm)
                {
                    continue;
                }
            }

            entry[i] = true;
            side[i] = signalSide == "long" ? MarketTrend.Long : MarketTrend.Short;
        }

        return new BlendFade2SignalArrays
        {
            EntryBar = entry,
            Side = side,
        };
    }

    public static MarketTrend? ResolveAtOpen(
        int index,
        IReadOnlyList<ChartCandle> candles,
        BlendFade2Config? config = null,
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

    private static double? ZScore(double[] values, int endIdx, int lookback)
    {
        var start = endIdx - lookback;
        if (start < 0)
        {
            return null;
        }

        double sum = 0;
        for (var i = start; i < endIdx; i++)
        {
            sum += values[i];
        }

        var mu = sum / lookback;
        double varSum = 0;
        for (var i = start; i < endIdx; i++)
        {
            var d = values[i] - mu;
            varSum += d * d;
        }

        var std = Math.Sqrt(varSum / lookback);
        if (std <= 0)
        {
            return null;
        }

        return (values[endIdx] - mu) / std;
    }

    private static double? PercentileRank(double[] closes, int endIdx, int lookback)
    {
        var start = endIdx - lookback;
        if (start < 0)
        {
            return null;
        }

        var lo = closes[start];
        var hi = closes[start];
        for (var i = start; i <= endIdx; i++)
        {
            lo = Math.Min(lo, closes[i]);
            hi = Math.Max(hi, closes[i]);
        }

        var span = hi - lo;
        if (span <= 0)
        {
            return null;
        }

        return (closes[endIdx] - lo) / span;
    }

    private static bool SessionOk(long openTimeUnix, BlendFade2Config cfg)
    {
        var start = cfg.SessionUtcStart;
        var end = cfg.SessionUtcEnd;
        if (start is null || end is null)
        {
            return true;
        }

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
