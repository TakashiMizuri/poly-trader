namespace PolyTrader.Core.Strategy;

/// <summary>Allowed Polymarket outcome price band for new entries (post-only limit bid).</summary>
public static class EntryPriceRules
{
    public const double DefaultMaxEntryPrice = 0.52;

    /// <summary>Default cap when no runtime override is configured.</summary>
    public const double MaxEntryPrice = DefaultMaxEntryPrice;

    public const double PatienceMaxEntryPrice = DefaultMaxEntryPrice;

    public static bool IsAllowed(double price, double maxEntryPrice) =>
        price > 0 && price <= maxEntryPrice;

    public static bool IsAllowed(double price) => price is > 0 and <= DefaultMaxEntryPrice;

    public static bool IsPatienceFillAllowed(double price, double maxEntryPrice) => IsAllowed(price, maxEntryPrice);

    public static bool IsPatienceFillAllowed(double price) => IsAllowed(price);
}
