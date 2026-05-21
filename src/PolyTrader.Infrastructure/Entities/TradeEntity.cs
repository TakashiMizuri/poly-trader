using PolyTrader.Core.Models;

namespace PolyTrader.Infrastructure.Entities;

public sealed class TradeEntity
{
    public int Id { get; set; }
    public long CandleTime { get; set; }
    public TradeSide Side { get; set; }
    public MarketTrend Trend { get; set; }
    public TradingMode Mode { get; set; }
    /// <summary>0 for live trades; paper account id for simulated trades.</summary>
    public int PaperAccountId { get; set; }
    public double StakeUsd { get; set; }
    /// <summary>Requested USD notional when live fill was partial; null = full fill (or paper).</summary>
    public double? RequestedStakeUsd { get; set; }
    public double EntryPrice { get; set; }
    public bool? Won { get; set; }
    public double? PnlUsd { get; set; }
    public string? PolymarketOrderId { get; set; }
    /// <summary>When winning live outcome tokens were redeemed on-chain (CTF).</summary>
    public DateTime? RedeemedAt { get; set; }
    public int? MarketId { get; set; }
    public MarketEntity? Market { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
