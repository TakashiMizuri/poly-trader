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
        double bidPriceHint,
        double? askPriceHint,
        TimeSpan firstWaveFillWait,
        TimeSpan remainderFillWait,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default);

    /// <summary>Single post-only maker wave (no remainder wave).</summary>
    Task<LiveMarketBuyOutcome> PlaceMakerLimitBuySingleWaveAsync(
        string tokenId,
        double stakeUsd,
        double bidPriceHint,
        double? askPriceHint,
        TimeSpan fillWait,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default);

    Task<double?> GetOrderMatchedSharesAsync(string orderId, CancellationToken ct = default);
}
