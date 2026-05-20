using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

/// <summary>
/// Exhaustion fade at bar open (1:1 with shine-trader resolveBetAtOpen + predictExhaustionFadeAtOpen).
/// </summary>
public static class BetResolver
{
    public static MarketTrend? ResolveAtOpen(
        int index,
        IReadOnlyList<ChartCandle> candles,
        IReadOnlyList<MarketTrend> trendAtOpen,
        TrendBetStrategyParams parameters)
    {
        var lookback = Math.Max(1, parameters.StructureLookback);
        var n = Math.Max(2, parameters.ExhaustionConsecutiveBars);
        var warmup = Math.Max(lookback, n);

        if (index < warmup)
        {
            return null;
        }

        var trend = trendAtOpen[index];
        var allBull = true;
        var allBear = true;
        for (var k = 0; k < n; k++)
        {
            var j = index - 1 - k;
            if (candles[j].Close <= candles[j].Open)
            {
                allBull = false;
            }

            if (candles[j].Close >= candles[j].Open)
            {
                allBear = false;
            }
        }

        if (trend == MarketTrend.Long && allBull)
        {
            return MarketTrend.Short;
        }

        if (trend == MarketTrend.Short && allBear)
        {
            return MarketTrend.Long;
        }

        return null;
    }

    public static MarketTrend? ResolveForUpcomingBar(
        IReadOnlyList<ChartCandle> candles,
        IReadOnlyList<MarketTrend> trendAtOpen,
        MarketTrend trendForNextOpen,
        TrendBetStrategyParams parameters)
    {
        var extendedTrend = trendAtOpen.Append(trendForNextOpen).ToList();
        return ResolveAtOpen(candles.Count, candles, extendedTrend, parameters);
    }
}
