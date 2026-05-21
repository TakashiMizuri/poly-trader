using System.Globalization;
using System.Text.Json;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class BlendFade2ParityTests
{
    [Fact]
    public void Generate_MatchesGolden_OnPinnedBinanceFixture()
    {
        var candles = LoadFixtureCandles();
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

        var parityPath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "parity_blend2.json"));

        Assert.True(File.Exists(parityPath), $"Missing golden file: {parityPath}");

        using var doc = JsonDocument.Parse(File.ReadAllText(parityPath));
        var pythonEntries = doc.RootElement.GetProperty("entries")
            .EnumerateArray()
            .Select(e => (e[0].GetInt32(), e[1].GetString()!))
            .ToList();

        Assert.Equal(pythonEntries.Count, csharpEntries.Count);
        for (var i = 0; i < pythonEntries.Count; i++)
        {
            Assert.Equal(pythonEntries[i].Item1, csharpEntries[i].Index);
            Assert.Equal(pythonEntries[i].Item2, csharpEntries[i].Side);
        }
    }

    [Fact(Skip = "Manual: refreshes tests/parity_blend2.json from tests/fixtures/binance_btcusdt_5m_500.json")]
    public void Export_ParityGolden_FromFixture()
    {
        var candles = LoadFixtureCandles();
        var cfg = BlendFade2Config.PresetPnlMax();
        var signals = BlendFade2Signals.Generate(candles, cfg);
        var entries = new List<object[]>();
        for (var i = 0; i < signals.EntryBar.Count; i++)
        {
            if (!signals.EntryBar[i] || signals.Side[i] is null)
            {
                continue;
            }

            var side = signals.Side[i]!.Value == MarketTrend.Long ? "long" : "short";
            entries.Add([i, side]);
        }

        var outPath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "parity_blend2.json"));
        var json = JsonSerializer.Serialize(new { entries });
        File.WriteAllText(outPath, json);
        Assert.NotEmpty(entries);
    }

    private static List<ChartCandle> LoadFixtureCandles()
    {
        var fixturePath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "fixtures", "binance_btcusdt_5m_500.json"));
        Assert.True(File.Exists(fixturePath), $"Missing fixture: {fixturePath}");

        var rows = JsonSerializer.Deserialize<JsonElement[]>(File.ReadAllText(fixturePath));
        Assert.NotNull(rows);
        return rows.Select(ParseBinanceKline).ToList();
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
