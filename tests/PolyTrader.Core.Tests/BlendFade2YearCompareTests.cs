using System.Globalization;
using System.Text.Json;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class BlendFade2YearCompareTests
{
    private static readonly string DataRoot =
        @"C:\All\Develop\trading-cursor-models\data\binance\btcusdt_5m";

    [Fact]
    public void BlendFade2_2022_MatchesPython_OnArchivedBinanceData()
    {
        const int year = 2022;
        var klinesPath = Path.Combine(DataRoot, $"btcusdt_5m_{year}.json");
        Assert.True(File.Exists(klinesPath), $"Missing data file: {klinesPath}");

        var goldenPath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..",
            $"golden_blend2_{year}_python.json"));

        Assert.True(File.Exists(goldenPath),
            $"Run scripts/compare_blend_fade2_year.py {year} first. Missing: {goldenPath}");

        using var doc = JsonDocument.Parse(File.ReadAllText(goldenPath));
        var root = doc.RootElement;

        var candles = LoadKlines(klinesPath);
        Assert.Equal(root.GetProperty("bars").GetInt32(), candles.Count);

        var cfg = BlendFade2Config.PresetPnlMax();
        var signals = BlendFade2Signals.Generate(candles, cfg);

        var csharpEntries = new List<(int Index, string Side)>();
        for (var i = 0; i < signals.EntryBar.Count; i++)
        {
            if (!signals.EntryBar[i] || signals.Side[i] is null)
            {
                continue;
            }

            var side = signals.Side[i]!.Value == MarketTrend.Long ? "long" : "short";
            csharpEntries.Add((i, side));
        }

        var pythonEntries = root.GetProperty("entries")
            .EnumerateArray()
            .Select(e => (e[0].GetInt32(), e[1].GetString()!))
            .ToList();

        Assert.Equal(pythonEntries.Count, csharpEntries.Count);
        for (var i = 0; i < pythonEntries.Count; i++)
        {
            Assert.Equal(pythonEntries[i].Item1, csharpEntries[i].Index);
            Assert.Equal(pythonEntries[i].Item2, csharpEntries[i].Side);
        }

        var parameters = new TrendBetStrategyParams
        {
            StartBalance = 100,
            BetStakeMode = BetStakeMode.Percent,
            BetStakePercent = 3,
            CommissionPercent = 1.8,
            MaxBetStakeUsd = 500,
            BlendFade2 = cfg,
        };

        var sim = TrendBetStrategySimulator.Simulate(candles, parameters);
        Assert.NotNull(sim);

        var pyBt = root.GetProperty("backtest");
        Assert.Equal(pyBt.GetProperty("bets").GetInt32(), sim!.TotalBets);
        Assert.Equal(pyBt.GetProperty("wins").GetInt32(), sim.Wins);
        Assert.Equal(pyBt.GetProperty("losses").GetInt32(), sim.Losses);
        Assert.Equal(pyBt.GetProperty("win_rate_pct").GetDouble(), sim.WinRate, 2);
        Assert.Equal(pyBt.GetProperty("ending_balance_usd").GetDouble(), sim.EndBalance, 2);
        Assert.Equal(pyBt.GetProperty("total_pnl_usd").GetDouble(), sim.NetPnl, 2);
        Assert.Equal(pyBt.GetProperty("max_drawdown_usd").GetDouble(), sim.MaxDrawdown, 2);
        var pyDdPct = pyBt.GetProperty("max_drawdown_pct").GetDouble();
        var pyDdPctAsPercent = pyDdPct <= 1 ? pyDdPct * 100 : pyDdPct;
        Assert.Equal(pyDdPctAsPercent, sim.MaxDrawdownPct, 2);

        var pyFees = pyBt.GetProperty("total_fees_usd").GetDouble();
        var csFees = sim.Bets.Sum(b => b.Commission);
        Assert.Equal(pyFees, csFees, 2);
    }

    private static List<ChartCandle> LoadKlines(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var list = new List<ChartCandle>();
        foreach (var k in doc.RootElement.GetProperty("klines").EnumerateArray())
        {
            list.Add(new ChartCandle
            {
                // Ms timestamps (same as Python open_times_ms); signals ignore time except session.
                Time = k.GetProperty("open_time").GetInt64(),
                Open = ParseDouble(k.GetProperty("open")),
                High = ParseDouble(k.GetProperty("high")),
                Low = ParseDouble(k.GetProperty("low")),
                Close = ParseDouble(k.GetProperty("close")),
            });
        }

        list.Sort((a, b) => a.Time.CompareTo(b.Time));
        return list;
    }

    private static double ParseDouble(JsonElement el) =>
        el.ValueKind == JsonValueKind.Number
            ? el.GetDouble()
            : double.Parse(el.GetString()!, CultureInfo.InvariantCulture);
}
