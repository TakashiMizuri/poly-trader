namespace PolyTrader.Infrastructure.Entities;

public sealed class BalanceSnapshotEntity
{
    public int Id { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public double CashBalance { get; set; }
    public double? Equity { get; set; }
    public string Source { get; set; } = "Paper";
    /// <summary>0 for live snapshots; paper account id otherwise.</summary>
    public int PaperAccountId { get; set; }
}
