using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

public static class CandleIntervalHelper
{
    public static long InferIntervalSeconds(IReadOnlyList<ChartCandle> candles, long defaultSeconds = 300)
    {
        if (candles.Count >= 2)
        {
            var delta = candles[^1].Time - candles[^2].Time;
            if (delta > 0)
            {
                return delta;
            }
        }

        return defaultSeconds;
    }

    public static long ParseBinanceIntervalSeconds(string interval, long defaultSeconds = 300)
    {
        if (string.IsNullOrWhiteSpace(interval))
        {
            return defaultSeconds;
        }

        var trimmed = interval.Trim().ToLowerInvariant();
        if (trimmed.Length < 2)
        {
            return defaultSeconds;
        }

        var unit = trimmed[^1];
        if (!int.TryParse(trimmed[..^1], out var value) || value <= 0)
        {
            return defaultSeconds;
        }

        return unit switch
        {
            'm' => value * 60L,
            'h' => value * 3600L,
            'd' => value * 86400L,
            _ => defaultSeconds
        };
    }
}
