using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

public sealed class BosLine
{
    public long FromTime { get; init; }
    public long ToTime { get; init; }
    public double Price { get; init; }
    public BosDirection Direction { get; init; }
}

public sealed class TrendSegment
{
    public long FromTime { get; init; }
    public long ToTime { get; init; }
    public MarketTrend Trend { get; init; }
}

public sealed class BosAnalysisOptions
{
    public int StructureLookback { get; init; } = 1;
    public int MinSegmentBars { get; init; }
    public int MinBarsBetweenFlips { get; init; }
    public double BreakBuffer { get; init; }
    public bool BodyBreakOnly { get; init; }
}

public sealed class BosAnalysis
{
    public IReadOnlyList<BosLine> Lines { get; init; } = [];
    public IReadOnlyList<TrendSegment> Segments { get; init; } = [];
    public IReadOnlyList<MarketTrend> TrendAtOpen { get; init; } = [];
    public IReadOnlyList<bool> BosFlipAt { get; init; } = [];
    public MarketTrend TrendForNextOpen { get; init; }
}

/// <summary>
/// Alternating trend + BoS (1:1 port from shine-trader detectBreakOfStructure.ts).
/// </summary>
public static class BreakOfStructureAnalyzer
{
    /// <summary>Keep in sync with PolyTraderOptions.CandleHistoryLimit (5000).</summary>
    public const int BosMaxCandles = 5000;

    public static BosAnalysis AnalyzeTrendAndBos(
        IReadOnlyList<ChartCandle> candles,
        BosAnalysisOptions? options = null)
    {
        if (candles.Count == 0)
        {
            return new BosAnalysis { TrendForNextOpen = MarketTrend.Long };
        }

        var opt = options ?? new BosAnalysisOptions();
        var lookback = Math.Max(1, opt.StructureLookback);
        var minSegmentBars = Math.Max(0, opt.MinSegmentBars);
        var minBarsBetweenFlips = Math.Max(0, opt.MinBarsBetweenFlips);
        var breakBuffer = Math.Max(0, opt.BreakBuffer);
        var bodyBreakOnly = opt.BodyBreakOnly;

        var lines = new List<BosLine>();
        var segments = new List<TrendSegment>();
        var trendAtOpen = new List<MarketTrend>();
        var bosFlipAt = new List<bool>();

        var trend = MarketTrend.Long;
        var barsInSegment = 0;
        var barsSinceLastFlip = int.MaxValue;
        trendAtOpen.Add(trend);
        bosFlipAt.Add(false);
        var segmentFromTime = candles[0].Time;

        void CloseSegment(long toTime)
        {
            segments.Add(new TrendSegment
            {
                FromTime = segmentFromTime,
                ToTime = toTime,
                Trend = trend
            });
            segmentFromTime = toTime;
        }

        bool CanFlip() =>
            barsInSegment >= minSegmentBars &&
            barsSinceLastFlip >= minBarsBetweenFlips;

        for (var i = 1; i < candles.Count; i++)
        {
            var candle = candles[i];
            trendAtOpen.Add(trend);
            bosFlipAt.Add(false);
            barsInSegment++;
            barsSinceLastFlip++;

            if (trend == MarketTrend.Long)
            {
                var refLow = ReferenceLow(candles, i, lookback);
                var breakPrice = StructureBreakPrice(candle, MarketTrend.Long, bodyBreakOnly);
                if (CanFlip() && breakPrice < refLow - breakBuffer)
                {
                    CloseSegment(candle.Time);
                    var fromIdx = Math.Max(0, i - lookback);
                    var refTime = candles[fromIdx].Time;
                    var refPrice = candles[fromIdx].Low;
                    for (var k = fromIdx + 1; k < i; k++)
                    {
                        if (candles[k].Low <= refPrice)
                        {
                            refPrice = candles[k].Low;
                            refTime = candles[k].Time;
                        }
                    }

                    lines.Add(new BosLine
                    {
                        FromTime = refTime,
                        ToTime = candle.Time,
                        Price = refPrice,
                        Direction = BosDirection.Bearish
                    });
                    bosFlipAt[i] = true;
                    trend = MarketTrend.Short;
                    barsInSegment = 0;
                    barsSinceLastFlip = 0;
                    continue;
                }
            }
            else
            {
                var refHigh = ReferenceHigh(candles, i, lookback);
                var breakPrice = StructureBreakPrice(candle, MarketTrend.Short, bodyBreakOnly);
                if (CanFlip() && breakPrice > refHigh + breakBuffer)
                {
                    CloseSegment(candle.Time);
                    var fromIdx = Math.Max(0, i - lookback);
                    var refTime = candles[fromIdx].Time;
                    var refPrice = candles[fromIdx].High;
                    for (var k = fromIdx + 1; k < i; k++)
                    {
                        if (candles[k].High >= refPrice)
                        {
                            refPrice = candles[k].High;
                            refTime = candles[k].Time;
                        }
                    }

                    lines.Add(new BosLine
                    {
                        FromTime = refTime,
                        ToTime = candle.Time,
                        Price = refPrice,
                        Direction = BosDirection.Bullish
                    });
                    bosFlipAt[i] = true;
                    trend = MarketTrend.Long;
                    barsInSegment = 0;
                    barsSinceLastFlip = 0;
                }
            }
        }

        segments.Add(new TrendSegment
        {
            FromTime = segmentFromTime,
            ToTime = candles[^1].Time,
            Trend = trend
        });

        return new BosAnalysis
        {
            Lines = lines,
            Segments = segments,
            TrendAtOpen = trendAtOpen,
            BosFlipAt = bosFlipAt,
            TrendForNextOpen = trend
        };
    }

    public static HashSet<long> GetBosFlipBarTimes(IEnumerable<BosLine> lines) =>
        lines.Select(l => l.ToTime).ToHashSet();

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

    private static double StructureBreakPrice(ChartCandle candle, MarketTrend trend, bool bodyBreakOnly)
    {
        if (!bodyBreakOnly)
        {
            return candle.Close;
        }

        return trend == MarketTrend.Long
            ? Math.Min(candle.Open, candle.Close)
            : Math.Max(candle.Open, candle.Close);
    }
}
