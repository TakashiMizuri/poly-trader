namespace PolyTrader.Core.Strategy;

/// <summary>Maps live CLOB entry failure text to persisted skip reasons.</summary>
public static class LiveEntryFailureClassifier
{
    public const string EntryPriceOutOfRange = "entry_price_out_of_range";
    public const string OrderFailed = "order_failed";

    public static string ToSkipReason(string? failureReason)
    {
        if (string.IsNullOrWhiteSpace(failureReason))
        {
            return OrderFailed;
        }

        if (failureReason.Contains("outside allowed entry band", StringComparison.OrdinalIgnoreCase)
            || failureReason.Contains("Maker entry not filled", StringComparison.OrdinalIgnoreCase))
        {
            return EntryPriceOutOfRange;
        }

        return OrderFailed;
    }
}
