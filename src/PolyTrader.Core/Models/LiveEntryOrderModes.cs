namespace PolyTrader.Core.Models;

/// <summary>Live entry order style stored in engine settings (Settings UI).</summary>
public static class LiveEntryOrderModes
{
    public const string Limit = "Limit";
    public const string Market = "Market";

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
}
