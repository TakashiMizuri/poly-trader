using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

public static class ShouldPlaceTrendBet
{
    public static int CountBarsSinceFlipAtOpen(IReadOnlyList<bool> bosFlipAt, int index)
    {
        var count = 0;
        for (var j = index - 1; j >= 0; j--)
        {
            if (bosFlipAt[j])
            {
                break;
            }

            count++;
        }

        return count;
    }

    public static double DistanceFromStructureAtOpen(
        IReadOnlyList<ChartCandle> candles,
        int index,
        MarketTrend trend,
        int structureLookback)
    {
        var open = candles[index].Open;
        if (trend == MarketTrend.Long)
        {
            return open - ReferenceLow(candles, index, structureLookback);
        }

        return ReferenceHigh(candles, index, structureLookback) - open;
    }

    public static bool AtOpen(
        int index,
        IReadOnlyList<ChartCandle> candles,
        IReadOnlyList<MarketTrend> trendAtOpen,
        IReadOnlyList<bool> bosFlipAt,
        TrendBetStrategyParams parameters)
    {
        var lookback = Math.Max(1, parameters.StructureLookback);
        var barsSinceFlip = CountBarsSinceFlipAtOpen(bosFlipAt, index);

        if (parameters.MinBarsSinceFlip > 0 && barsSinceFlip < parameters.MinBarsSinceFlip)
        {
            return false;
        }

        if (parameters.MaxBarsSinceFlip > 0 && barsSinceFlip > parameters.MaxBarsSinceFlip)
        {
            return false;
        }

        if (parameters.MinDistanceFromStructure > 0)
        {
            var distance = DistanceFromStructureAtOpen(
                candles,
                index,
                trendAtOpen[index],
                lookback);
            if (distance < parameters.MinDistanceFromStructure)
            {
                return false;
            }
        }

        return true;
    }

    private static double ReferenceLow(IReadOnlyList<ChartCandle> candles, int index, int lookback)
    {
        var reference = double.PositiveInfinity;
        for (var k = Math.Max(0, index - lookback); k < index; k++)
        {
            reference = Math.Min(reference, candles[k].Low);
        }

        return reference;
    }

    private static double ReferenceHigh(IReadOnlyList<ChartCandle> candles, int index, int lookback)
    {
        var reference = double.NegativeInfinity;
        for (var k = Math.Max(0, index - lookback); k < index; k++)
        {
            reference = Math.Max(reference, candles[k].High);
        }

        return reference;
    }
}
