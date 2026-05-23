using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;

namespace PolyTrader.Infrastructure.Entities;

public sealed class EngineSettingsEntity
{
    public int Id { get; set; } = 1;
    public TradingMode TradingMode { get; set; } = TradingMode.Paper;
    public int? ActivePaperAccountId { get; set; }
    public PaperAccountEntity? ActivePaperAccount { get; set; }
    public bool IsRunning { get; set; }
    /// <summary>Stake sizing applied while the engine is running (updated on start when pending differs).</summary>
    public BetStakeMode BetStakeMode { get; set; } = BetStakeMode.Percent;
    /// <summary>Fixed USD stake when <see cref="BetStakeMode"/> is Fixed.</summary>
    public double BetStakeUsd { get; set; } = 1;
    /// <summary>Percent of balance per bet when mode is Percent (3 = 3%).</summary>
    public double BetStakePercent { get; set; } = 3;
    /// <summary>Cap stake in USD; null = no cap.</summary>
    public double? MaxBetStakeUsd { get; set; } = 500;

    /// <summary>UI draft; synced to active when engine is stopped or on start.</summary>
    public BetStakeMode PendingBetStakeMode { get; set; } = BetStakeMode.Percent;
    public double PendingBetStakeUsd { get; set; } = 1;
    public double PendingBetStakePercent { get; set; } = 3;
    public double? PendingMaxBetStakeUsd { get; set; } = 500;
    /// <summary>Paper/backtest fee model; live maker entries use 0% on Polymarket.</summary>
    public double CommissionPercent { get; set; } = 0;
    /// <summary>When false, background and post-win CTF redeems are skipped.</summary>
    public bool AutoRedeemEnabled { get; set; } = true;
    /// <summary>Live entry: <see cref="LiveEntryOrderModes.Limit"/> (post-only) or <see cref="LiveEntryOrderModes.Market"/> (IOC taker).</summary>
    public string LiveEntryOrderMode { get; set; } = LiveEntryOrderModes.Limit;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
