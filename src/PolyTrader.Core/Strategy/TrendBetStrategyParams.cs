namespace PolyTrader.Core.Strategy;

public sealed class TrendBetStrategyParams
{
    public double StartBalance { get; init; } = 100;
    public double BetStake { get; init; } = 1;
    public BetStakeMode BetStakeMode { get; init; } = BetStakeMode.Percent;
    public double BetStakePercent { get; init; } = 1;
    public double CommissionPercent { get; init; }
    public int StructureLookback { get; init; } = 5;
    public int BosMinSegmentBars { get; init; }
    public int BosMinBarsBetweenFlips { get; init; }
    public double BosBreakBuffer { get; init; }
    public bool BosBodyBreakOnly { get; init; }
    public int MinBarsSinceFlip { get; init; }
    public int MaxBarsSinceFlip { get; init; }
    public double MinDistanceFromStructure { get; init; }
    public int ExhaustionConsecutiveBars { get; init; } = 3;

    public static TrendBetStrategyParams Default { get; } = new();
}
