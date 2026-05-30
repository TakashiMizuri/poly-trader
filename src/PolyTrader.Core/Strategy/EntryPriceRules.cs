namespace PolyTrader.Core.Strategy;

/// <summary>Allowed Polymarket outcome price band for new entries (post-only limit bid).</summary>
public static class EntryPriceRules
{
    public const double MaxEntryPrice = 0.52;

    /// <summary>Same band as immediate entry (patience no longer uses a tighter cap).</summary>
    public const double PatienceMaxEntryPrice = MaxEntryPrice;

    public static bool IsAllowed(double price) => price is > 0 and <= MaxEntryPrice;

    public static bool IsPatienceFillAllowed(double price) => IsAllowed(price);
}
