using PolyTrader.Core.Strategy;

namespace PolyTrader.Core.Tests;

public class LimitEntryRulesTests
{
    [Theory]
    [InlineData(0.50, 2.50)]
    [InlineData(0.53, 2.65)]
    public void MinStakeUsd_rounds_up_to_cents(double bid, double expected)
    {
        Assert.Equal(expected, LimitEntryRules.MinStakeUsd(bid), 2);
    }

    [Fact]
    public void Plan_bumps_when_requested_below_min()
    {
        var plan = LimitEntryRules.Plan(150, 1.50, null, 0.53);
        Assert.True(plan.CanTrade);
        Assert.True(plan.WillBump);
        Assert.Equal(2.65, plan.EffectiveStakeUsd, 2);
    }

    [Fact]
    public void Plan_blocks_when_balance_too_low()
    {
        var plan = LimitEntryRules.Plan(2.00, 0.50, null, 0.53);
        Assert.False(plan.CanTrade);
        Assert.NotNull(plan.BlockReason);
    }

    [Fact]
    public void MinBalanceForPercentStake_at_one_percent()
    {
        var minBal = LimitEntryRules.MinBalanceForPercentStake(0.53, 1);
        Assert.Equal(265, minBal);
    }
}
