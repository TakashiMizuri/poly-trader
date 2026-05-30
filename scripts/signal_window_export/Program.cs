using System.Globalization;
using System.Text.Json;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

if (args.Length < 1)
{
    Console.Error.WriteLine("Usage: signal_window_export <binance_json> [time_unit=sec]");
    return 1;
}

var path = args[0];
var useSeconds = args.Length < 2 || args[1] != "ms";

using var doc = JsonDocument.Parse(File.ReadAllText(path));
var klines = doc.RootElement.GetProperty("klines").EnumerateArray()
    .Select(k => new ChartCandle
    {
        Time = useSeconds
            ? k.GetProperty("open_time").GetInt64() / 1000
            : k.GetProperty("open_time").GetInt64(),
        Open = ParseDouble(k.GetProperty("open")),
        High = ParseDouble(k.GetProperty("high")),
        Low = ParseDouble(k.GetProperty("low")),
        Close = ParseDouble(k.GetProperty("close")),
    })
    .OrderBy(c => c.Time)
    .ToList();

var cfg = BlendFade2Config.PresetPnlMax();
var signals = BlendFade2Signals.Generate(klines, cfg);
var entries = new List<object[]>();
for (var i = 0; i < signals.EntryBar.Count; i++)
{
    if (!signals.EntryBar[i] || signals.Side[i] is null)
    {
        continue;
    }

    var side = signals.Side[i]!.Value == MarketTrend.Long ? "long" : "short";
    entries.Add([klines[i].Time, i, side]);
}

var payload = new
{
    bars = klines.Count,
    preset = "blend2_pnl_max",
    entries,
};
Console.WriteLine(JsonSerializer.Serialize(payload));
return 0;

static double ParseDouble(JsonElement el) =>
    el.ValueKind == JsonValueKind.Number
        ? el.GetDouble()
        : double.Parse(el.GetString()!, CultureInfo.InvariantCulture);
