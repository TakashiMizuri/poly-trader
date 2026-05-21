namespace PolyTrader.Infrastructure.Polymarket;

public interface IPolymarketRestTradingClient
{
    bool IsConfigured { get; }

    Task<double?> GetCollateralBalanceUsdAsync(
        CancellationToken ct = default,
        int maxAttempts = 5);

    /// <summary>Place IOC market buy for USD notional (partial fills allowed).</summary>
    Task<LiveMarketBuyOutcome> PlaceMarketBuyUsdAsync(
        string tokenId,
        double stakeUsd,
        double? entryPriceHint = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default);

    Task<double?> GetOrderMatchedSharesAsync(string orderId, CancellationToken ct = default);
}
