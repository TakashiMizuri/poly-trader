using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class StrategyGoldenTests
{
    [Fact]
    public void BosAnalysis_WithStructureLookback5_MatchesExhaustionEngine()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 105, Low = 99, Close = 104 },
            new() { Time = 1300, Open = 104, High = 106, Low = 98, Close = 97 },
            new() { Time = 1600, Open = 97, High = 99, Low = 95, Close = 96 },
            new() { Time = 1900, Open = 96, High = 102, Low = 95, Close = 101 },
            new() { Time = 2200, Open = 101, High = 103, Low = 100, Close = 102 },
            new() { Time = 2500, Open = 102, High = 104, Low = 101, Close = 103 },
        };

        var bos = BreakOfStructureAnalyzer.AnalyzeTrendAndBos(
            candles,
            new BosAnalysisOptions { StructureLookback = 5 });

        Assert.Equal(6, bos.TrendAtOpen.Count);
        Assert.Equal(6, bos.BosFlipAt.Count);
        Assert.Equal(MarketTrend.Long, bos.TrendForNextOpen);
    }

    [Fact]
    public void ExhaustionFade_SignalsShortAfterThreeBullBarsInLongTrend()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 101, Low = 99, Close = 100.5 },
            new() { Time = 1300, Open = 100.5, High = 102, Low = 100, Close = 101 },
            new() { Time = 1600, Open = 101, High = 103, Low = 100.5, Close = 102 },
            new() { Time = 1900, Open = 102, High = 104, Low = 101.5, Close = 103 },
            new() { Time = 2200, Open = 103, High = 105, Low = 102.5, Close = 104 },
            new() { Time = 2500, Open = 104, High = 106, Low = 103.5, Close = 105 },
        };

        var bos = BreakOfStructureAnalyzer.AnalyzeTrendAndBos(
            candles,
            BreakOfStructureAnalyzer.OptionsFromParams(TrendBetStrategyParams.Default));

        var bet = BetResolver.ResolveAtOpen(
            5,
            candles,
            bos.TrendAtOpen,
            TrendBetStrategyParams.Default);

        Assert.Equal(MarketTrend.Short, bet);
    }

    [Fact]
    public void Simulate_ExhaustionFade_SkipsBarsWithoutSignal()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 105, Low = 99, Close = 104 },
            new() { Time = 1300, Open = 104, High = 106, Low = 98, Close = 97 },
            new() { Time = 1600, Open = 97, High = 99, Low = 95, Close = 96 },
            new() { Time = 1900, Open = 96, High = 102, Low = 95, Close = 101 },
        };

        var bos = BreakOfStructureAnalyzer.AnalyzeTrendAndBos(
            candles,
            BreakOfStructureAnalyzer.OptionsFromParams(TrendBetStrategyParams.Default));

        var sim = TrendBetStrategySimulator.Simulate(
            candles,
            bos.TrendAtOpen,
            bos.BosFlipAt);

        Assert.NotNull(sim);
        Assert.True(sim!.TotalBets < candles.Count);
        Assert.True(sim.SkippedBars > 0);
    }

    [Fact]
    public void ComputeBetPnl_WinAndLoss()
    {
        var win = TrendBetStrategySimulator.ComputeBetPnl(true, 1, 0);
        var loss = TrendBetStrategySimulator.ComputeBetPnl(false, 1, 0);
        Assert.Equal(1, win.Pnl);
        Assert.Equal(-1, loss.Pnl);
    }

    [Fact]
    public void ProcessCandleClose_SettlesOnlyWhenBetWasSignaled()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 105, Low = 99, Close = 104 },
            new() { Time = 1300, Open = 104, High = 106, Low = 98, Close = 97 },
        };

        var actions = TrendBetStrategySimulator.ProcessCandleClose(
            candles[^1],
            candles,
            candleIntervalSeconds: 300);

        Assert.NotNull(actions);
        Assert.Null(actions!.Settlement);
        Assert.Null(actions.Entry);
    }

    [Fact]
    public void ProcessCandleClose_SignalsNextEntryWhenExhaustionMatches()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 101, Low = 99, Close = 100.5 },
            new() { Time = 1300, Open = 100.5, High = 102, Low = 100, Close = 101 },
            new() { Time = 1600, Open = 101, High = 103, Low = 100.5, Close = 102 },
            new() { Time = 1900, Open = 102, High = 104, Low = 101.5, Close = 103 },
            new() { Time = 2200, Open = 103, High = 105, Low = 102.5, Close = 104 },
        };

        var actions = TrendBetStrategySimulator.ProcessCandleClose(
            candles[^1],
            candles,
            candleIntervalSeconds: 300);

        Assert.NotNull(actions);
        Assert.Null(actions!.Settlement);
        Assert.NotNull(actions.Entry);
        Assert.Equal(2500, actions.Entry!.TargetCandleTime);
        Assert.Equal(MarketTrend.Short, actions.Entry.Trend);
    }
}
