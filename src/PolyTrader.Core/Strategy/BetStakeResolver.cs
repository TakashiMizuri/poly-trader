namespace PolyTrader.Core.Strategy;

public enum BetStakeMode
{
    Fixed,
    Percent,
}

public static class BetStakeResolver
{
    public static double RequestedStake(double balance, TrendBetStrategyParams parameters) =>
        parameters.BetStakeMode == BetStakeMode.Percent
            ? balance * parameters.BetStakePercent / 100
            : parameters.BetStake;

    public static double? ResolveForBalance(double balance, TrendBetStrategyParams parameters)
    {
        return SafeBetStake.Resolve(balance, RequestedStake(balance, parameters));
    }
}
