using System.Text.Json;
using System.Text.Json.Serialization;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class TradeEntryWaveDto
{
    public int Wave { get; set; }
    public string Label { get; set; } = "";
    public double RequestedUsd { get; set; }
    public double FilledUsd { get; set; }
    public double FillPercent { get; set; }
    public double? EntryPrice { get; set; }
    public string? OrderId { get; set; }
}

public static class TradeEntryWavesJson
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize(IReadOnlyList<LiveEntryWaveFill> waves)
    {
        var dtos = waves.Select(ToDto).ToList();
        return JsonSerializer.Serialize(dtos, JsonOptions);
    }

    public static IReadOnlyList<TradeEntryWaveDto>? Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<List<TradeEntryWaveDto>>(json, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    public static TradeEntryWaveDto ToDto(LiveEntryWaveFill wave) =>
        new()
        {
            Wave = wave.WaveIndex,
            Label = wave.Label,
            RequestedUsd = wave.RequestedStakeUsd,
            FilledUsd = wave.FilledStakeUsd,
            FillPercent = Math.Round(wave.FillPercent, 1),
            EntryPrice = wave.EntryPrice,
            OrderId = wave.OrderId,
        };
}
