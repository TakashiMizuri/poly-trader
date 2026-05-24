namespace PolyTrader.Core.Strategy;

/// <summary>Allowed Polymarket outcome price band for new entries (post-only limit bid).</summary>
public static class EntryPriceRules
{
    public const double MaxEntryPrice = 0.52;

    public static bool IsAllowed(double price) => price is > 0 and <= MaxEntryPrice;
}
