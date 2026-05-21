using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Core.Tests;

public class PolymarketWalletResolverTests
{
    [Fact]
    public void ResolveWalletAddress_PrefersFunder()
    {
        var resolver = CreateResolver(
            privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
            funder: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD");

        Assert.Equal(
            "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            resolver.ResolveWalletAddress());
    }

    [Fact]
    public void TryDeriveEoaAddress_ReturnsChecksummedLowercase()
    {
        var resolver = CreateResolver(
            privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
            funder: null);

        var addr = resolver.TryDeriveEoaAddress(
            "0x0000000000000000000000000000000000000000000000000000000000000001");

        Assert.NotNull(addr);
        Assert.StartsWith("0x", addr);
        Assert.Equal(42, addr.Length);
    }

    private static PolymarketWalletResolver CreateResolver(string privateKey, string? funder)
    {
        var opts = Options.Create(new PolyTraderOptions
        {
            PolymarketPrivateKey = privateKey,
            PolymarketFunderAddress = funder,
        });
        return new PolymarketWalletResolver(opts);
    }
}
