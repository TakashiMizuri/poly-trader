namespace PolyTrader.Core.Strategy;

public static class SafeBetStake
{
    public const double BalanceFloor = 0.01;
    public const double MinBetStake = 0.01;

    public static double? Resolve(double balance, double requestedStake)
    {
        var maxAffordable = balance - BalanceFloor;
        var stake = Math.Min(requestedStake, maxAffordable);
        return stake < MinBetStake ? null : stake;
    }

    public static double ClampBalanceAfterBet(double balance) =>
        Math.Max(balance, BalanceFloor);
}
