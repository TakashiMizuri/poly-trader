namespace PolyTrader.Core.Strategy;

public sealed class TrendBetStrategyParams
{
    public double StartBalance { get; init; } = 100;
    public double BetStake { get; init; } = 1;
    public BetStakeMode BetStakeMode { get; init; } = BetStakeMode.Percent;
    /// <summary>Percent of balance per bet (3 = 3%, matches STRATEGY.md stake_pct=0.03).</summary>
    public double BetStakePercent { get; init; } = 3;
    /// <summary>Entry fee as % of stake (1.8 = 1.8%, matches entry_fee_rate=0.018).</summary>
    public double CommissionPercent { get; init; } = 1.8;
    /// <summary>Cap stake in USD (500 for bos_flow backtest; null = no cap).</summary>
    public double? MaxBetStakeUsd { get; init; } = 500;
    public BosFlowConfig BosFlow { get; init; } = BosFlowConfig.PresetActive();

    public static TrendBetStrategyParams Default { get; } = new();

    /// <summary>Live/paper engine: BoS flow preset + stake sizing from engine settings.</summary>
    public static TrendBetStrategyParams ForLiveEngine(
        double balance,
        BetStakeMode betStakeMode,
        double betStakeUsd,
        double betStakePercent,
        double? maxBetStakeUsd,
        double commissionPercent)
    {
        return new TrendBetStrategyParams
        {
            StartBalance = balance,
            BetStake = betStakeUsd,
            BetStakeMode = betStakeMode,
            BetStakePercent = betStakePercent,
            CommissionPercent = commissionPercent > 0 ? commissionPercent : 1.8,
            MaxBetStakeUsd = maxBetStakeUsd is > 0 ? maxBetStakeUsd : null,
            BosFlow = BosFlowConfig.PresetActive(),
        };
    }
}
