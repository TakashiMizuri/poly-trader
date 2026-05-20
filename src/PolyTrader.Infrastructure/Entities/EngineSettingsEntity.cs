using PolyTrader.Core.Models;

namespace PolyTrader.Infrastructure.Entities;

public sealed class EngineSettingsEntity
{
    public int Id { get; set; } = 1;
    public TradingMode TradingMode { get; set; } = TradingMode.Paper;
    public int? ActivePaperAccountId { get; set; }
    public PaperAccountEntity? ActivePaperAccount { get; set; }
    public bool IsRunning { get; set; }
    public double BetStakeUsd { get; set; } = 1;
    public double CommissionPercent { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
