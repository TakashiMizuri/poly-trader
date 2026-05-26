using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class LiveEntryFailureClassifierTests
{
    [Fact]
    public void ToSkipReason_maps_band_limit_to_no_entry()
    {
        var reason =
            "Maker wave 1 limit 0.6000 outside allowed entry band (0, 0.52] on token x (bid 0.62, ask 0.61)";
        Assert.Equal(LiveEntryFailureClassifier.EntryPriceOutOfRange, LiveEntryFailureClassifier.ToSkipReason(reason));
    }

    [Fact]
    public void ToSkipReason_maps_maker_not_filled_to_no_entry()
    {
        var reason =
            "Maker entry not filled: limit 0.6000 outside allowed entry band (0, 0.52] for remainder $3.69 (bid 0.6200, ask 0.6100)";
        Assert.Equal(LiveEntryFailureClassifier.EntryPriceOutOfRange, LiveEntryFailureClassifier.ToSkipReason(reason));
    }

    [Fact]
    public void ToSkipReason_keeps_insufficient_fill_as_order_failed()
    {
        var reason =
            "Insufficient maker fill after 2 waves on token: 0.0000 shares (min 0.01)";
        Assert.Equal(LiveEntryFailureClassifier.OrderFailed, LiveEntryFailureClassifier.ToSkipReason(reason));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ToSkipReason_empty_failure_is_order_failed(string? reason) =>
        Assert.Equal(LiveEntryFailureClassifier.OrderFailed, LiveEntryFailureClassifier.ToSkipReason(reason));
}
