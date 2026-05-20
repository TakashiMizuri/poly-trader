using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

public interface IPolymarketDataApiService
{
    string? ResolveWalletAddress();

    /// <summary>
    /// Infers win/loss for a held outcome token from Data API position pricing (post-resolution).
    /// </summary>
    Task<bool?> TryInferOutcomeFromPositionAsync(
        string userAddress,
        string assetTokenId,
        CancellationToken ct = default);
}

/// <summary>
/// Polymarket Data API — user positions (https://data-api.polymarket.com).
/// </summary>
public sealed class PolymarketDataApiService : IPolymarketDataApiService
{
    private const string DataApiBase = "https://data-api.polymarket.com";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<PolymarketDataApiService> _logger;

    public PolymarketDataApiService(
        IHttpClientFactory httpClientFactory,
        IOptions<PolyTraderOptions> options,
        ILogger<PolymarketDataApiService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public string? ResolveWalletAddress()
    {
        var funder = _options.PolymarketFunderAddress?.Trim();
        if (!string.IsNullOrEmpty(funder) && funder.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            return funder;
        }

        return null;
    }

    public async Task<bool?> TryInferOutcomeFromPositionAsync(
        string userAddress,
        string assetTokenId,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userAddress) || string.IsNullOrWhiteSpace(assetTokenId))
        {
            return null;
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url =
                $"{DataApiBase}/positions?user={Uri.EscapeDataString(userAddress)}&limit=500&offset=0&sizeThreshold=0";
            var json = await client.GetStringAsync(url, ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var row in doc.RootElement.EnumerateArray())
            {
                var asset = row.TryGetProperty("asset", out var a) ? a.GetString()?.Trim() : null;
                if (!string.Equals(asset, assetTokenId, StringComparison.Ordinal))
                {
                    continue;
                }

                var curPrice = ReadDouble(row, "curPrice");
                if (curPrice >= 0.99)
                {
                    return true;
                }

                if (curPrice <= 0.01)
                {
                    return false;
                }

                var redeemable = row.TryGetProperty("redeemable", out var r) && r.ValueKind == JsonValueKind.True;
                if (redeemable)
                {
                    return true;
                }

                _logger.LogDebug(
                    "Position for token {TokenId} not clearly resolved (curPrice={CurPrice})",
                    assetTokenId,
                    curPrice);
                return null;
            }

            _logger.LogDebug("No Data API position row for token {TokenId}", assetTokenId);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch Polymarket positions for {User}", userAddress);
            return null;
        }
    }

    private static double ReadDouble(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var el))
        {
            return 0;
        }

        return el.ValueKind switch
        {
            JsonValueKind.Number => el.GetDouble(),
            JsonValueKind.String => double.TryParse(
                el.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out var v)
                ? v
                : 0,
            _ => 0,
        };
    }
}
