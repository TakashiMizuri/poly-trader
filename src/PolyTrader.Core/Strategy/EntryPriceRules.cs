namespace PolyTrader.Core.Strategy;

/// <summary>Allowed Polymarket outcome price band for new entries (post-only limit bid).</summary>
public static class EntryPriceRules
{
    public const double MaxEntryPrice = 0.52;

    /// <summary>Max outcome price when filling during the post-open patience window.</summary>
    public const double PatienceMaxEntryPrice = 0.50;

    public static readonly TimeSpan PatienceWaitDuration = TimeSpan.FromSeconds(30);

    public static bool IsAllowed(double price) => price is > 0 and <= MaxEntryPrice;

    public static bool IsPatienceFillAllowed(double price) =>
        price is > 0 and <= PatienceMaxEntryPrice;
}
