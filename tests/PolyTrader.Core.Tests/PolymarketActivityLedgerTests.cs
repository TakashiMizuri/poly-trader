using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Core.Tests;

public sealed class PolymarketActivityLedgerTests
{
    [Fact]
    public void InferWonFromCashFlow_WinWhenNetPositiveAfterBuyAndRedeem()
    {
        var flow = new PolymarketMarketCashSummary
        {
            BuyUsdc = 4,
            RedeemUsdc = 7.97,
            HasRedeem = true,
        };

        Assert.True(PolymarketActivityLedger.InferWonFromCashFlow(flow, 4));
    }

    [Fact]
    public void InferWonFromCashFlow_LossWhenZeroRedeem()
    {
        var flow = new PolymarketMarketCashSummary
        {
            BuyUsdc = 3.29,
            RedeemUsdc = 0,
            HasRedeem = true,
        };

        Assert.False(PolymarketActivityLedger.InferWonFromCashFlow(flow, 3.29));
    }

    [Fact]
    public void InferWonFromCashFlow_NullWhenNoRedeemYet()
    {
        var flow = new PolymarketMarketCashSummary { BuyUsdc = 3.5 };
        Assert.Null(PolymarketActivityLedger.InferWonFromCashFlow(flow, 3.5));
    }

    [Fact]
    public void BuildByConditionId_AggregatesBuyAndRedeem()
    {
        const string conditionId =
            "0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917";
        var events = new[]
        {
            new PolymarketActivityEvent(
                1,
                "TRADE",
                "BUY",
                4,
                conditionId,
                "btc-updown-5m-100",
                null),
            new PolymarketActivityEvent(
                2,
                "REDEEM",
                null,
                7.97,
                conditionId,
                "btc-updown-5m-100",
                null),
        };

        var map = PolymarketActivityLedger.BuildByConditionId(events);
        Assert.True(map.ContainsKey(conditionId));
        Assert.Equal(4, map[conditionId].BuyUsdc, 2);
        Assert.Equal(7.97, map[conditionId].RedeemUsdc, 2);
        Assert.Equal(3.97, map[conditionId].NetUsdc, 2);
    }
}
