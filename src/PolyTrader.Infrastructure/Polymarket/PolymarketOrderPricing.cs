using System.Globalization;

namespace PolyTrader.Infrastructure.Polymarket;

internal static class PolymarketOrderPricing
{
    public static bool IsValidOutcomePrice(double? price) => price is > 0 and <= 1;

    public static decimal RoundDownToTick(decimal price, decimal tickSize)
    {
        if (tickSize <= 0)
        {
            return price;
        }

        var steps = Math.Floor(price / tickSize);
        return steps * tickSize;
    }

    public static decimal ComputeShareQuantity(double stakeUsd, decimal limitPrice)
    {
        if (limitPrice <= 0)
        {
            return 0;
        }

        var shares = (decimal)stakeUsd / limitPrice;
        return Math.Floor(shares * 10_000m) / 10_000m;
    }

    public static double? ParseApiPrice(string? raw) =>
        double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
            ? v
            : null;
}
