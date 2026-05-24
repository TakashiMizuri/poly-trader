using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Core.Tests;

public class MakerLimitPricingTests
{
    [Fact]
    public void ComputePostOnlyBuyLimit_clamps_below_ask_when_bid_equals_ask()
    {
        var limit = MakerLimitPricing.ComputePostOnlyBuyLimit(0.52, 0.52, 0.01m, 3.05);
        Assert.Equal(0.51m, limit);
    }

    [Fact]
    public void ComputePostOnlyBuyLimit_caps_by_stake_for_high_bid()
    {
        var limit = MakerLimitPricing.ComputePostOnlyBuyLimit(0.70, 0.71, 0.01m, 3.05);
        Assert.Equal(0.61m, limit);
    }

    [Fact]
    public void ComputePostOnlyBuyLimit_uses_bid_when_spread_wide()
    {
        var limit = MakerLimitPricing.ComputePostOnlyBuyLimit(0.50, 0.55, 0.01m, 10);
        Assert.Equal(0.50m, limit);
    }
}
