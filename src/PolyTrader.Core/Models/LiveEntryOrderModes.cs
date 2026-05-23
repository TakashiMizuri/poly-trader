namespace PolyTrader.Core.Models;

/// <summary>Live entry order style stored in engine settings (Settings UI).</summary>
public static class LiveEntryOrderModes
{
    public const string Limit = "Limit";
    public const string Market = "Market";
    /// <summary>Limit when stake meets 5-share min; otherwise market at configured stake (no bump).</summary>
    public const string LimitElseMarket = "LimitElseMarket";

    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return Limit;
        }

        var v = value.Trim();
        if (v.Equals(Market, StringComparison.OrdinalIgnoreCase))
        {
            return Market;
        }

        if (v.Equals(LimitElseMarket, StringComparison.OrdinalIgnoreCase)
            || v.Equals("Limit-Market", StringComparison.OrdinalIgnoreCase))
        {
            return LimitElseMarket;
        }

        // Legacy env/appsettings value and synonym for limit entries.
        if (v.Equals("Maker", StringComparison.OrdinalIgnoreCase)
            || v.Equals(Limit, StringComparison.OrdinalIgnoreCase))
        {
            return Limit;
        }

        return Limit;
    }

    public static bool IsMarket(string? value) =>
        Normalize(value) == Market;

    public static bool IsLimitElseMarket(string? value) =>
        Normalize(value) == LimitElseMarket;

    public static bool UsesLimitBump(string? value) =>
        Normalize(value) == Limit;
}
