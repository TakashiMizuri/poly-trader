using Microsoft.Extensions.Options;
using Nethereum.Signer;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

public interface IPolymarketWalletResolver
{
    bool IsPrivateKeyConfigured { get; }

    /// <summary>Trading/funder wallet: POLYMARKET_FUNDER_ADDRESS or EOA derived from private key.</summary>
    string? ResolveWalletAddress();

    string? TryDeriveEoaAddress(string privateKey);
}

public sealed class PolymarketWalletResolver : IPolymarketWalletResolver
{
    private readonly PolyTraderOptions _options;

    public PolymarketWalletResolver(IOptions<PolyTraderOptions> options) => _options = options.Value;

    public bool IsPrivateKeyConfigured =>
        !string.IsNullOrWhiteSpace(_options.PolymarketPrivateKey)
        && _options.PolymarketPrivateKey.StartsWith("0x", StringComparison.OrdinalIgnoreCase);

    public string? ResolveWalletAddress()
    {
        var funder = _options.PolymarketFunderAddress?.Trim();
        if (!string.IsNullOrEmpty(funder) && funder.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            return funder.ToLowerInvariant();
        }

        return TryDeriveEoaAddress(_options.PolymarketPrivateKey ?? "");
    }

    public string? TryDeriveEoaAddress(string privateKey)
    {
        if (string.IsNullOrWhiteSpace(privateKey) || !privateKey.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        try
        {
            var key = new EthECKey(privateKey);
            return key.GetPublicAddress().ToLowerInvariant();
        }
        catch
        {
            return null;
        }
    }
}
