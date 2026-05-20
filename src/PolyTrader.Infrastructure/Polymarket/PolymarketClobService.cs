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
    Task<double?> GetCollateralBalanceAsync(CancellationToken ct = default);
    /// <summary>Best ask (market buy) from CLOB REST.</summary>
    Task<double?> TryGetBuyPriceAsync(string tokenId, CancellationToken ct = default);
    /// <summary>Midpoint from CLOB REST.</summary>
    Task<double?> TryGetMidPriceAsync(string tokenId, CancellationToken ct = default);
    Task<string?> PlaceMarketOrderAsync(string tokenId, double sizeUsd, CancellationToken ct = default);
}

/// <summary>
/// Simplified CLOB REST client. Live orders require API credentials from env.
/// </summary>
public sealed class PolymarketClobService : IPolymarketClobService
{
    private const string ClobHost = "https://clob.polymarket.com";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<PolymarketClobService> _logger;

    public PolymarketClobService(
        IHttpClientFactory httpClientFactory,
        IOptions<PolyTraderOptions> options,
        ILogger<PolymarketClobService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_options.PolymarketPrivateKey)
        && _options.PolymarketPrivateKey.StartsWith("0x", StringComparison.OrdinalIgnoreCase);

    public async Task<double?> GetCollateralBalanceAsync(CancellationToken ct = default)
    {
        if (!IsConfigured) return null;

        try
        {
            // Balance requires authenticated L2 headers; return null if not fully wired.
            _logger.LogDebug("CLOB balance fetch requires derived API key (configure POLYMARKET_PRIVATE_KEY)");
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch CLOB balance");
            return null;
        }
    }

    public async Task<double?> TryGetBuyPriceAsync(string tokenId, CancellationToken ct = default) =>
        await TryGetClobPriceAsync(tokenId, "BUY", ct);

    public async Task<double?> TryGetMidPriceAsync(string tokenId, CancellationToken ct = default)
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

    public async Task<string?> PlaceMarketOrderAsync(string tokenId, double sizeUsd, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("Live order skipped: POLYMARKET_PRIVATE_KEY not configured");
            return null;
        }

        _logger.LogInformation(
            "Live order placeholder for token {TokenId} size ${Size}. Wire Nethereum + CLOB L2 signing for production.",
            tokenId,
            sizeUsd);

        await Task.CompletedTask;
        return $"paper-live-{Guid.NewGuid():N}";
    }
}
