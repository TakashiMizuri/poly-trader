using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Core.Tests;

public class PolymarketCtfRedeemTests
{
    [Fact]
    public async Task RedeemConditionAsync_WithoutKey_ReturnsError()
    {
        var svc = new PolymarketCtfRedeemService(
            Options.Create(new PolyTraderOptions()),
            new PolymarketWalletResolver(Options.Create(new PolyTraderOptions())),
            NullLogger<PolymarketCtfRedeemService>.Instance);

        var result = await svc.RedeemConditionAsync(
            "0x" + new string('a', 64));

        Assert.False(result.Success);
        Assert.Equal("missing_private_key", result.Error);
    }

    [Fact]
    public async Task RedeemConditionAsync_InvalidConditionId_ReturnsError()
    {
        var svc = new PolymarketCtfRedeemService(
            Options.Create(new PolyTraderOptions
            {
                PolymarketPrivateKey =
                    "0x0000000000000000000000000000000000000000000000000000000000000001",
            }),
            new PolymarketWalletResolver(Options.Create(new PolyTraderOptions
            {
                PolymarketPrivateKey =
                    "0x0000000000000000000000000000000000000000000000000000000000000001",
            })),
            NullLogger<PolymarketCtfRedeemService>.Instance);

        var result = await svc.RedeemConditionAsync("not-a-condition");

        Assert.False(result.Success);
        Assert.Equal("invalid_condition_id", result.Error);
    }
}
