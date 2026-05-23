namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Normalizes Polymarket condition ids for consistent DB / API matching.</summary>
public static class PolymarketConditionId
{
    public static string? Normalize(string? conditionId)
    {
        if (string.IsNullOrWhiteSpace(conditionId))
        {
            return null;
        }

        var hex = conditionId.Trim();
        if (hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            hex = hex[2..];
        }

        if (hex.Length != 64)
        {
            return null;
        }

        for (var i = 0; i < hex.Length; i++)
        {
            var c = hex[i];
            var isHex = (c >= '0' && c <= '9')
                || (c >= 'a' && c <= 'f')
                || (c >= 'A' && c <= 'F');
            if (!isHex)
            {
                return null;
            }
        }

        return "0x" + hex.ToLowerInvariant();
    }

    public static bool Equals(string? a, string? b) =>
        Normalize(a) != null
        && Normalize(a) == Normalize(b);
}
