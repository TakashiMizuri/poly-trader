namespace PolyTrader.Infrastructure.Entities;

public sealed class CandleSnapshotEntity
{
    public long Time { get; set; }
    public double Open { get; set; }
    public double High { get; set; }
    public double Low { get; set; }
    public double Close { get; set; }
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}
