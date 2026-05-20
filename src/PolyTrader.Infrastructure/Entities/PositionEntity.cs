using PolyTrader.Core.Models;

namespace PolyTrader.Infrastructure.Entities;

public sealed class PositionEntity
{
    public int Id { get; set; }
    public int MarketId { get; set; }
    public MarketEntity Market { get; set; } = null!;
    public TradeSide Side { get; set; }
    public double SizeUsd { get; set; }
    public double AvgPrice { get; set; }
    public TradingMode Mode { get; set; }
    public bool IsOpen { get; set; } = true;
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
}
