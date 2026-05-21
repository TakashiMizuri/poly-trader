namespace PolyTrader.Infrastructure.Entities;

public sealed class BalanceSnapshotEntity
{
    public int Id { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    /// <summary>5m candle open time (ms) this snapshot belongs to; null for legacy rows.</summary>
    public long? CandleTime { get; set; }
    public double CashBalance { get; set; }
    public double? Equity { get; set; }
    public string Source { get; set; } = "Paper";
    /// <summary>0 for live snapshots; paper account id otherwise.</summary>
    public int PaperAccountId { get; set; }
}
