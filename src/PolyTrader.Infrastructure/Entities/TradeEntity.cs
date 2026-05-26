using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

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
    /// <summary>Balance used when sizing this trade's stake.</summary>
    public double? StakeBalanceUsd { get; set; }
    public BetStakeMode? BetStakeMode { get; set; }
    /// <summary>Percent of balance when <see cref="BetStakeMode"/> is Percent.</summary>
    public double? BetStakePercent { get; set; }
    /// <summary>Fixed USD stake when <see cref="BetStakeMode"/> is Fixed.</summary>
    public double? BetStakeFixedUsd { get; set; }
    public double StakeUsd { get; set; }
    /// <summary>Requested USD notional when live fill was partial; null = full fill (or paper).</summary>
    public double? RequestedStakeUsd { get; set; }
    public double EntryPrice { get; set; }
    public bool? Won { get; set; }
    public double? PnlUsd { get; set; }
    /// <summary>|PnL| ÷ entry stake (cached at settlement).</summary>
    public double? WinPayoutRatio { get; set; }
    public string? PolymarketOrderId { get; set; }
    /// <summary>JSON array of maker entry waves (attempt 1 / remainder attempt 2).</summary>
    public string? EntryWavesJson { get; set; }
    /// <summary>When winning live outcome tokens were redeemed on-chain (CTF).</summary>
    public DateTime? RedeemedAt { get; set; }
    public int? MarketId { get; set; }
    public MarketEntity? Market { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
