namespace PolyTrader.Core.Strategy;

/// <summary>
/// High-frequency BoS flow strategy for 5m Polymarket direction bets
/// (1:1 with trading-cursor-models strategies/bos_flow).
/// </summary>
public sealed class BosFlowConfig
{
    public int SwingLeft { get; init; } = 2;
    public int SwingRight { get; init; } = 2;
    public double MinBreakPct { get; init; } = 0.0001;
    public int EmaPeriod { get; init; } = 50;
    public int MaxBiasBars { get; init; } = 18;
    public double MinBodyRatio { get; init; } = 0.15;
    public bool UseRsiGate { get; init; }
    public int RsiPeriod { get; init; } = 14;
    public double RsiLongMin { get; init; } = 50.0;
    public double RsiShortMax { get; init; } = 50.0;
    public bool AllowLong { get; init; } = true;
    public bool AllowShort { get; init; } = true;
    /// <summary>Mean-reversion: long BoS context -> short bet, short context -> long bet.</summary>
    public bool FadeBos { get; init; } = true;
    public int? SessionUtcStart { get; init; }
    public int? SessionUtcEnd { get; init; }

    /// <summary>Best preset: flow_active (WR &gt; 50%, max bets).</summary>
    public static BosFlowConfig PresetActive() => new()
    {
        SwingLeft = 2,
        SwingRight = 2,
        MinBreakPct = 0.0001,
        EmaPeriod = 50,
        MaxBiasBars = 18,
        MinBodyRatio = 0.05,
        FadeBos = true,
    };

    public static BosFlowConfig Default { get; } = PresetActive();
}
