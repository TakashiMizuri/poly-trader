using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class StrategyGoldenTests
{
    [Fact]
    public void BosFlow_PresetActive_HasFlowActiveParameters()
    {
        var cfg = BosFlowConfig.PresetActive();
        Assert.Equal(2, cfg.SwingLeft);
        Assert.Equal(2, cfg.SwingRight);
        Assert.Equal(0.0001, cfg.MinBreakPct);
        Assert.Equal(50, cfg.EmaPeriod);
        Assert.Equal(18, cfg.MaxBiasBars);
        Assert.Equal(0.05, cfg.MinBodyRatio);
        Assert.True(cfg.FadeBos);
        Assert.False(cfg.UseRsiGate);
    }

    [Fact]
    public void StructureMath_ConfirmSwingHigh_DetectsPivot()
    {
        var highs = new[] { 1.0, 2.0, 5.0, 3.0, 2.0, 1.0 };
        Assert.True(StructureMath.ConfirmSwingHigh(highs, 2, 2, 2));
        Assert.False(StructureMath.ConfirmSwingHigh(highs, 1, 2, 2));
    }

    [Fact]
    public void Simulate_BosFlow_SkipsBarsWithoutSignal()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 105, Low = 99, Close = 104 },
            new() { Time = 1300, Open = 104, High = 106, Low = 98, Close = 97 },
            new() { Time = 1600, Open = 97, High = 99, Low = 95, Close = 96 },
            new() { Time = 1900, Open = 96, High = 102, Low = 95, Close = 101 },
        };

        var sim = TrendBetStrategySimulator.Simulate(candles);
        Assert.NotNull(sim);
        Assert.True(sim!.TotalBets < candles.Count);
        Assert.True(sim.SkippedBars > 0);
    }

    [Fact]
    public void ComputeBetPnl_WinAndLoss_WithFee_AtFiftyCents()
    {
        var win = TrendBetStrategySimulator.ComputeBetPnl(true, 100, 1.8, 0.5);
        var loss = TrendBetStrategySimulator.ComputeBetPnl(false, 100, 1.8, 0.5);
        Assert.Equal(98.2, win.Pnl, 2);
        Assert.Equal(-101.8, loss.Pnl, 2);
    }

    [Fact]
    public void ComputeBetPnl_UsesEntryPrice_ForWinPayout()
    {
        var winAt40 = TrendBetStrategySimulator.ComputeBetPnl(true, 3, 1.8, 0.4);
        var winAt70 = TrendBetStrategySimulator.ComputeBetPnl(true, 3, 1.8, 0.7);
        Assert.True(winAt40.Pnl > winAt70.Pnl);
        Assert.Equal(7.5 * 1 - 3 - 3 * 0.018, winAt40.Pnl, 2);
    }

    [Fact]
    public void ForLiveEngine_UsesStrategyMdStakeAndFeeDefaults()
    {
        var p = TrendBetStrategyParams.ForLiveEngine(
            100,
            BetStakeMode.Percent,
            betStakeUsd: 1,
            betStakePercent: 3,
            maxBetStakeUsd: 500,
            commissionPercent: 1.8);
        Assert.Equal(3, p.BetStakePercent);
        Assert.Equal(1.8, p.CommissionPercent);
        Assert.Equal(500, p.MaxBetStakeUsd);
        Assert.Equal(3, BetStakeResolver.RequestedStake(100, p));
    }

    [Fact]
    public void BetStakeResolver_CapsAtMaxBetStakeUsd()
    {
        var p = new TrendBetStrategyParams
        {
            BetStakeMode = BetStakeMode.Percent,
            BetStakePercent = 10,
            MaxBetStakeUsd = 500,
        };
        var stake = BetStakeResolver.RequestedStake(100_000, p);
        Assert.Equal(500, stake);
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
    public void ProcessCandleClose_WhenBufferIncludesNextFormingBar_StillEvaluates()
    {
        var candles = new List<ChartCandle>
        {
            new() { Time = 1000, Open = 100, High = 105, Low = 99, Close = 104 },
            new() { Time = 1300, Open = 104, High = 106, Low = 98, Close = 97 },
            new() { Time = 1600, Open = 97, High = 99, Low = 96, Close = 96 },
        };

        var actions = TrendBetStrategySimulator.ProcessCandleClose(
            candles[1],
            candles,
            candleIntervalSeconds: 300);

        Assert.NotNull(actions);
    }

    [Fact]
    public async Task ProcessCandleClose_OnRecentBinanceCandles_ProducesEntriesAndMatchesBacktest()
    {
        using var client = new HttpClient();
        var rows = await client.GetFromJsonAsync<JsonElement[]>(
            "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=500");

        Assert.NotNull(rows);
        Assert.True(rows.Length >= 100);

        var candles = rows.Select(ParseBinanceKline).ToList();
        var backtest = TrendBetStrategySimulator.Simulate(candles);
        Assert.NotNull(backtest);
        Assert.True(
            backtest!.TotalBets > 5,
            $"Backtest should place bets on real BTC 5m data, got {backtest.TotalBets}");

        var entries = 0;
        for (var i = 1; i < candles.Count - 1; i++)
        {
            var closed = candles[i];
            var bufferWithForming = candles.Take(i + 2).ToList();
            var result = TrendBetStrategySimulator.ProcessCandleClose(
                closed,
                bufferWithForming,
                candleIntervalSeconds: 300);

            Assert.NotNull(result);

            if (result!.Entry != null)
            {
                entries++;
                var signals = BosFlowSignals.Generate(candles, BosFlowConfig.PresetActive());
                var nextIndex = i + 1;
                Assert.True(signals.EntryBar[nextIndex]);
                Assert.Equal(signals.Side[nextIndex], result.Entry.Trend);
            }
        }

        Assert.True(
            entries > 5,
            $"Live path should signal entries on real data, got {entries}");
    }

    private static ChartCandle ParseBinanceKline(JsonElement row) => new()
    {
        Time = row[0].GetInt64() / 1000,
        Open = double.Parse(row[1].GetString()!, CultureInfo.InvariantCulture),
        High = double.Parse(row[2].GetString()!, CultureInfo.InvariantCulture),
        Low = double.Parse(row[3].GetString()!, CultureInfo.InvariantCulture),
        Close = double.Parse(row[4].GetString()!, CultureInfo.InvariantCulture),
    };

}
