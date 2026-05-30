namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Post-only maker buy limit from bid/ask and stake (CLOB min 5 shares).</summary>
internal static class MakerLimitPricing
{
    public const decimal MinOrderShares = 5m;

    /// <summary>
    /// Highest tick-aligned post-only buy: at or below bid, strictly below ask, affordable for min shares.
    /// </summary>
    public static decimal? ComputePostOnlyBuyLimit(
        double bidHint,
        double? askHint,
        decimal tickSize,
        double stakeUsd,
        int askTickMargin = 1)
    {
        if (bidHint <= 0 || !double.IsFinite(bidHint) || stakeUsd < 0.01 || tickSize <= 0)
        {
            return null;
        }

        var bid = PolymarketOrderPricing.RoundDownToTick((decimal)bidHint, tickSize);
        if (bid <= 0)
        {
            return null;
        }

        var candidate = bid;
        if (askHint is > 0 and <= 1)
        {
            var marginTicks = Math.Max(1, askTickMargin);
            var cap = PolymarketOrderPricing.RoundDownToTick(
                (decimal)askHint.Value - tickSize * marginTicks,
                tickSize);
            if (cap > 0)
            {
                candidate = Math.Min(candidate, cap);
            }
        }

        candidate = CapToAffordablePrice(candidate, tickSize, stakeUsd);
        if (candidate <= 0)
        {
            return null;
        }

        if (PolymarketOrderPricing.ComputeShareQuantity(stakeUsd, candidate) < MinOrderShares)
        {
            return null;
        }

        var minStake = MinOrderShares * candidate;
        if ((decimal)stakeUsd + 0.001m < minStake)
        {
            return null;
        }

        return candidate;
    }

    /// <summary>Clamp limit so a post-only buy stays strictly below the current ask.</summary>
    public static decimal CapPostOnlyAgainstAsk(
        decimal price,
        double askHint,
        decimal tickSize,
        int askTickMargin = 1)
    {
        if (askHint is not > 0 and <= 1)
        {
            return price;
        }

        var marginTicks = Math.Max(1, askTickMargin);
        var cap = PolymarketOrderPricing.RoundDownToTick(
            (decimal)askHint - tickSize * marginTicks,
            tickSize);
        return cap > 0 ? Math.Min(price, cap) : price;
    }

    private static decimal CapToAffordablePrice(decimal price, decimal tickSize, double stakeUsd)
    {
        var maxByStake = PolymarketOrderPricing.RoundDownToTick((decimal)stakeUsd / MinOrderShares, tickSize);
        if (maxByStake <= 0)
        {
            return 0;
        }

        return Math.Min(price, maxByStake);
    }
}
