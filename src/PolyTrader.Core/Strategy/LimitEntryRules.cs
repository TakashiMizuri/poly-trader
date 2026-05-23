namespace PolyTrader.Core.Strategy;

/// <summary>Polymarket resting limit (GTC post-only) constraints for maker entries.</summary>
public static class LimitEntryRules
{
    public const decimal MinOrderShares = 5m;

    public static double MinStakeUsd(double limitPrice) =>
        MinStakeUsd((decimal)limitPrice);

    public static double MinStakeUsd(decimal limitPrice)
    {
        if (limitPrice <= 0)
        {
            return double.PositiveInfinity;
        }

        var min = MinOrderShares * limitPrice;
        return (double)(Math.Ceiling(min * 100m) / 100m);
    }

    /// <summary>Balance needed so percent stake meets limit min without bump.</summary>
    public static double? MinBalanceForPercentStake(double limitPrice, double stakePercent)
    {
        if (stakePercent <= 0)
        {
            return null;
        }

        var minStake = MinStakeUsd(limitPrice);
        if (!double.IsFinite(minStake))
        {
            return null;
        }

        return Math.Ceiling(minStake / (stakePercent / 100.0) * 100) / 100;
    }

    public static LimitEntryStakePlan Plan(
        double balance,
        double requestedStake,
        double? maxBetStakeUsd,
        double bidPrice)
    {
        if (bidPrice <= 0 || !double.IsFinite(bidPrice))
        {
            return new LimitEntryStakePlan(
                requestedStake,
                0,
                double.PositiveInfinity,
                false,
                false,
                "No valid bid price for limit entry preview");
        }

        var clobMinStake = MinStakeUsd(bidPrice);
        var maxAffordable = balance - SafeBetStake.BalanceFloor;

        if (maxAffordable + 0.001 < clobMinStake)
        {
            return new LimitEntryStakePlan(
                requestedStake,
                0,
                clobMinStake,
                false,
                false,
                $"Need ≥ ${clobMinStake:F2} for {MinOrderShares} shares @ bid {bidPrice:F4}; balance ${balance:F2}");
        }

        if (requestedStake + 0.001 >= clobMinStake)
        {
            var capped = maxBetStakeUsd is > 0
                ? Math.Min(requestedStake, maxBetStakeUsd.Value)
                : requestedStake;
            capped = Math.Min(capped, maxAffordable);
            if (capped + 0.001 >= clobMinStake)
            {
                return new LimitEntryStakePlan(
                    requestedStake,
                    capped,
                    clobMinStake,
                    true,
                    false,
                    null);
            }
        }

        var bumped = Math.Min(clobMinStake, maxAffordable);
        if (maxBetStakeUsd is > 0)
        {
            bumped = Math.Min(bumped, maxBetStakeUsd.Value);
        }

        if (bumped + 0.001 >= clobMinStake)
        {
            return new LimitEntryStakePlan(
                requestedStake,
                bumped,
                clobMinStake,
                true,
                requestedStake + 0.001 < clobMinStake,
                null);
        }

        return new LimitEntryStakePlan(
            requestedStake,
            0,
            clobMinStake,
            false,
            false,
            $"Cap or balance blocks ≥ ${clobMinStake:F2} for {MinOrderShares} shares @ bid {bidPrice:F4}");
    }
}

public sealed record LimitEntryStakePlan(
    double RequestedStakeUsd,
    double EffectiveStakeUsd,
    double ClobMinStakeUsd,
    bool CanTrade,
    bool WillBump,
    string? BlockReason);
