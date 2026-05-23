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

    /// <summary>
    /// Two-wave post-only maker buy (0% fee): wave 1 on full stake, wave 2 on remainder only; no taker top-up.
    /// </summary>
    Task<LiveMarketBuyOutcome> PlaceMakerLimitBuyUsdAsync(
        string tokenId,
        double stakeUsd,
        double limitPrice,
        TimeSpan firstWaveFillWait,
        TimeSpan remainderFillWait,
        Func<CancellationToken, Task<double?>>? refreshBidAsync = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default);

    Task<double?> GetOrderMatchedSharesAsync(string orderId, CancellationToken ct = default);
}
