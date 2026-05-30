using PolyTrader.Core.Models;

namespace PolyTrader.Infrastructure.Entities;

public sealed class SkippedBetEntity
{
    public int Id { get; set; }
    public long CandleTime { get; set; }
    public int MarketId { get; set; }
    public MarketEntity Market { get; set; } = null!;
    public TradingMode Mode { get; set; }
    public int PaperAccountId { get; set; }
    public string SkipReason { get; set; } = "";
    /// <summary>CLOB / engine message (e.g. post-only cross) for diagnostics.</summary>
    public string? SkipDetail { get; set; }
    public string? Side { get; set; }
    public string? Trend { get; set; }
    public double? InitialBid { get; set; }
    public double? InitialAsk { get; set; }
    public bool? SignalPresent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public const int MaxSkipDetailLength = 512;

    public static string? TruncateDetail(string? detail)
    {
        if (string.IsNullOrWhiteSpace(detail))
        {
            return null;
        }

        var trimmed = detail.Trim();
        return trimmed.Length <= MaxSkipDetailLength
            ? trimmed
            : trimmed[..MaxSkipDetailLength];
    }
}
