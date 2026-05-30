namespace PolyTrader.Core.Strategy;

/// <summary>Maps live CLOB entry failure text to persisted skip reasons.</summary>
public static class LiveEntryFailureClassifier
{
    public const string EntryPriceOutOfRange = "entry_price_out_of_range";
    public const string OrderFailed = "order_failed";
    public const string QuoteUnavailable = "quote_unavailable";

    public static string ToSkipReason(string? failureReason)
    {
        if (string.IsNullOrWhiteSpace(failureReason))
        {
            return OrderFailed;
        }

        if (failureReason.Contains("quote unavailable", StringComparison.OrdinalIgnoreCase)
            || failureReason.Contains("no valid best bid", StringComparison.OrdinalIgnoreCase)
            || failureReason.Contains("best ask unavailable", StringComparison.OrdinalIgnoreCase))
        {
            return QuoteUnavailable;
        }

        if (failureReason.Contains("outside allowed entry band", StringComparison.OrdinalIgnoreCase)
            || failureReason.Contains("outside allowed band", StringComparison.OrdinalIgnoreCase)
            || failureReason.Contains("Patience bid hint", StringComparison.OrdinalIgnoreCase))
        {
            return EntryPriceOutOfRange;
        }

        return OrderFailed;
    }
}
