using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Core.Tests;

public class PolymarketConditionIdTests
{
    private const string Lower =
        "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    [Fact]
    public void Normalize_accepts_uppercase_and_lowercase()
    {
        var upper = "0xABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
        Assert.Equal(Lower, PolymarketConditionId.Normalize(upper));
        Assert.Equal(Lower, PolymarketConditionId.Normalize(Lower));
    }

    [Fact]
    public void Equals_ignores_case_and_prefix()
    {
        var noPrefix = Lower[2..];
        Assert.True(PolymarketConditionId.Equals(Lower, noPrefix));
        Assert.True(PolymarketConditionId.Equals(Lower, Lower.ToUpperInvariant()));
    }

    [Fact]
    public void Normalize_rejects_invalid_length()
    {
        Assert.Null(PolymarketConditionId.Normalize("0xabc"));
    }
}
