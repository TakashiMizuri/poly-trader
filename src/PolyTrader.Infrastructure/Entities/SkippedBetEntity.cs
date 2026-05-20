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
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
