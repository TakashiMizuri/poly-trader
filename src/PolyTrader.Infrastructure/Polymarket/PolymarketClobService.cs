using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

public interface IPolymarketClobService
{
    bool IsConfigured { get; }
    Task<double?> GetCollateralBalanceAsync(
        CancellationToken ct = default,
        int maxAttempts = 5);
    /// <summary>Best ask (taker buy) from CLOB REST.</summary>
    Task<double?> TryGetBuyPriceAsync(string tokenId, CancellationToken ct = default);
    /// <summary>Best bid (maker buy) from CLOB REST.</summary>
    Task<double?> TryGetBidPriceAsync(string tokenId, CancellationToken ct = default);
    /// <summary>Midpoint from CLOB REST.</summary>
    Task<double?> TryGetMidPriceAsync(string tokenId, CancellationToken ct = default);
    /// <summary>Live entry: maker limit (default) or IOC market per <see cref="PolyTraderOptions.LiveEntryOrderMode"/>.</summary>
    Task<LiveMarketBuyOutcome> PlaceEntryOrderAsync(
        string tokenId,
        double sizeUsd,
        double? bidPriceHint = null,
        double? askPriceHint = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default);
}

/// <summary>
/// Polymarket CLOB: authenticated trading via Polymarket.Net; public prices via REST fallback.
/// </summary>
public sealed class PolymarketClobService : IPolymarketClobService
{
    private const string ClobHost = "https://clob.polymarket.com";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IPolymarketRestTradingClient _trading;
    private readonly IPolymarketWalletResolver _wallet;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<PolymarketClobService> _logger;

    public PolymarketClobService(
        IHttpClientFactory httpClientFactory,
        IPolymarketRestTradingClient trading,
        IPolymarketWalletResolver wallet,
        IOptions<PolyTraderOptions> options,
        ILogger<PolymarketClobService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _trading = trading;
        _wallet = wallet;
        _options = options.Value;
        _logger = logger;
    }

    public bool IsConfigured => _trading.IsConfigured;

    public Task<double?> GetCollateralBalanceAsync(
        CancellationToken ct = default,
        int maxAttempts = 5) =>
        _trading.GetCollateralBalanceUsdAsync(ct, maxAttempts);

    public async Task<double?> TryGetBuyPriceAsync(string tokenId, CancellationToken ct) =>
        await TryGetClobPriceAsync(tokenId, "BUY", ct);

    public Task<double?> TryGetBidPriceAsync(string tokenId, CancellationToken ct) =>
        TryGetClobPriceAsync(tokenId, "SELL", ct);

    public async Task<double?> TryGetMidPriceAsync(string tokenId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(tokenId))
        {
            return null;
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"{ClobHost}/midpoint?token_id={Uri.EscapeDataString(tokenId)}";
            using var doc = await JsonDocument.ParseAsync(
                await client.GetStreamAsync(url, ct),
                cancellationToken: ct);
            var root = doc.RootElement;
            if (root.TryGetProperty("mid", out var mid))
            {
                return ParsePriceElement(mid);
            }

            if (root.TryGetProperty("mid_price", out var midPrice))
            {
                return ParsePriceElement(midPrice);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "CLOB midpoint fetch failed for {TokenId}", tokenId);
        }

        return null;
    }

    private async Task<double?> TryGetClobPriceAsync(
        string tokenId,
        string side,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(tokenId))
        {
            return null;
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url =
                $"{ClobHost}/price?token_id={Uri.EscapeDataString(tokenId)}&side={Uri.EscapeDataString(side)}";
            using var doc = await JsonDocument.ParseAsync(
                await client.GetStreamAsync(url, ct),
                cancellationToken: ct);
            if (doc.RootElement.TryGetProperty("price", out var price))
            {
                return ParsePriceElement(price);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "CLOB {Side} price fetch failed for {TokenId}", side, tokenId);
        }

        return null;
    }

    private static double? ParsePriceElement(JsonElement el) =>
        el.ValueKind switch
        {
            JsonValueKind.Number => el.GetDouble(),
            JsonValueKind.String => double.TryParse(
                el.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out var v)
                ? v
                : null,
            _ => null,
        };

    public async Task<LiveMarketBuyOutcome> PlaceEntryOrderAsync(
        string tokenId,
        double sizeUsd,
        double? bidPriceHint = null,
        double? askPriceHint = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            const string reason = "POLYMARKET_PRIVATE_KEY not configured";
            _logger.LogWarning("Live order skipped: {Reason}", reason);
            return LiveMarketBuyOutcome.Fail(reason);
        }

        var useMarket = string.Equals(
            _options.LiveEntryOrderMode,
            "Market",
            StringComparison.OrdinalIgnoreCase);

        if (useMarket)
        {
            _logger.LogInformation(
                "Placing live market buy token {TokenId} notional ${Size:F2} wallet {Wallet}",
                tokenId,
                sizeUsd,
                _wallet.ResolveWalletAddress() ?? "unknown");

            return await _trading.PlaceMarketBuyUsdAsync(
                tokenId,
                sizeUsd,
                askPriceHint,
                entryKey,
                ct);
        }

        var bid = bidPriceHint;
        if (!PolymarketOrderPricing.IsValidOutcomePrice(bid))
        {
            bid = await TryGetBidPriceAsync(tokenId, ct);
        }

        if (!PolymarketOrderPricing.IsValidOutcomePrice(bid))
        {
            const string reason = "No valid best bid for maker limit entry";
            _logger.LogWarning("{Reason} token {TokenId}", reason, tokenId);
            return LiveMarketBuyOutcome.Fail(reason);
        }

        var firstWait = TimeSpan.FromSeconds(Math.Max(1, _options.LiveMakerFillWaitSeconds));
        var remainderWait = TimeSpan.FromSeconds(Math.Max(1, _options.LiveMakerRemainderFillWaitSeconds));
        _logger.LogInformation(
            "Placing live maker two-wave buy token {TokenId} notional ${Size:F2} @ {Bid:F4} wave1={Wave1Seconds}s wave2={Wave2Seconds}s wallet {Wallet}",
            tokenId,
            sizeUsd,
            bid,
            firstWait.TotalSeconds,
            remainderWait.TotalSeconds,
            _wallet.ResolveWalletAddress() ?? "unknown");

        return await _trading.PlaceMakerLimitBuyUsdAsync(
            tokenId,
            sizeUsd,
            bid!.Value,
            firstWait,
            remainderWait,
            ct => TryGetBidPriceAsync(tokenId, ct),
            entryKey,
            ct);
    }
}
