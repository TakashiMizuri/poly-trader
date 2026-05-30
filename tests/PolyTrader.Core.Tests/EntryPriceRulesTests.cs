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
    [InlineData(0.52, true)]
    [InlineData(0.51, true)]
    [InlineData(0.53, false)]
    public void IsPatienceFillAllowed_matches_immediate_band(double price, bool expected) =>
        Assert.Equal(expected, EntryPriceRules.IsPatienceFillAllowed(price));

    [Theory]
    [InlineData(0.50, 0.50, true)]
    [InlineData(0.51, 0.50, false)]
    [InlineData(0.49, 0.52, true)]
    public void IsAllowed_respects_configured_max(double price, double max, bool expected) =>
        Assert.Equal(expected, EntryPriceRules.IsAllowed(price, max));
}

public class EntryExecutionSettingsTests
{
    [Fact]
    public void ResolvePatienceWait_clamps_to_window_end_safety_margin()
    {
        var settings = new EntryExecutionSettings { MaxWaitSeconds = 180 };
        var windowStartMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var windowEndMs = windowStartMs + 45_000;

        var wait = settings.ResolvePatienceWait(windowStartMs, windowEndMs);

        Assert.True(wait.TotalSeconds <= 15 + 0.5);
        Assert.True(wait.TotalSeconds >= 1);
    }

    [Fact]
    public void ClampMaxWaitSeconds_respects_bounds()
    {
        Assert.Equal(1, EntryExecutionSettings.ClampMaxWaitSeconds(0));
        Assert.Equal(180, EntryExecutionSettings.ClampMaxWaitSeconds(999));
        Assert.Equal(60, EntryExecutionSettings.ClampMaxWaitSeconds(60));
    }
}
