using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class EntryPriceRulesTests
{
    [Theory]
    [InlineData(0.01, true)]
    [InlineData(0.52, true)]
    [InlineData(0.50, true)]
    [InlineData(0, false)]
    [InlineData(0.53, false)]
    [InlineData(0.73, false)]
    [InlineData(1, false)]
    public void IsAllowed_respects_max_band(double price, bool expected) =>
        Assert.Equal(expected, EntryPriceRules.IsAllowed(price));

    [Theory]
    [InlineData(0.50, true)]
    [InlineData(0.51, false)]
    [InlineData(0.52, false)]
    public void IsPatienceFillAllowed_respects_patience_band(double price, bool expected) =>
        Assert.Equal(expected, EntryPriceRules.IsPatienceFillAllowed(price));
}
