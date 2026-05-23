using PolyTrader.Core.Strategy;

namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Polymarket CLOB constraints for live limit orders (shares, not USD).</summary>
public static class PolymarketClobLimits
{
    public const decimal MinOrderShares = LimitEntryRules.MinOrderShares;

    public static double MinStakeUsd(double limitPrice) =>
        LimitEntryRules.MinStakeUsd(limitPrice);

    public static double MinStakeUsd(decimal limitPrice) =>
        LimitEntryRules.MinStakeUsd(limitPrice);

    public static bool MeetsMinOrderSize(double stakeUsd, decimal limitPrice) =>
        ComputeShareQuantity(stakeUsd, limitPrice) >= MinOrderShares;

    public static decimal ComputeShareQuantity(double stakeUsd, decimal limitPrice) =>
        PolymarketOrderPricing.ComputeShareQuantity(stakeUsd, limitPrice);
}
