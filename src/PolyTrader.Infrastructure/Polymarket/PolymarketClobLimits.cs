namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Polymarket CLOB constraints for live limit orders (shares, not USD).</summary>
public static class PolymarketClobLimits
{
    /// <summary>Minimum outcome shares per limit order on BTC 5m markets (CLOB rejects below this).</summary>
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

    public static bool MeetsMinOrderSize(double stakeUsd, decimal limitPrice) =>
        ComputeShareQuantity(stakeUsd, limitPrice) >= MinOrderShares;

    public static decimal ComputeShareQuantity(double stakeUsd, decimal limitPrice) =>
        PolymarketOrderPricing.ComputeShareQuantity(stakeUsd, limitPrice);
}
