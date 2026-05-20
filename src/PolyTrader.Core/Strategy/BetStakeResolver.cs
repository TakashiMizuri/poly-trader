namespace PolyTrader.Core.Strategy;

public enum BetStakeMode
{
    Fixed,
    Percent,
}

public static class BetStakeResolver
{
    public static double RequestedStake(double balance, TrendBetStrategyParams parameters)
    {
        var stake = parameters.BetStakeMode == BetStakeMode.Percent
            ? balance * parameters.BetStakePercent / 100
            : parameters.BetStake;

        if (parameters.MaxBetStakeUsd is > 0)
        {
            stake = Math.Min(stake, parameters.MaxBetStakeUsd.Value);
        }

        return stake;
    }

    public static double? ResolveForBalance(double balance, TrendBetStrategyParams parameters)
    {
        return SafeBetStake.Resolve(balance, RequestedStake(balance, parameters));
    }
}
