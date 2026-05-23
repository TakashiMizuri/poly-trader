using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Models;

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

    /// <summary>
    /// Whether the wallet still holds redeemable outcome tokens for <paramref name="assetTokenId"/>.
    /// <c>false</c> when the position row is gone or not redeemable (already redeemed).
    /// <c>null</c> on API failure.
    /// </summary>
    Task<bool?> TryIsOutcomeTokenRedeemableAsync(
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
    private readonly IPolymarketWalletResolver _wallet;
    private readonly ILogger<PolymarketDataApiService> _logger;

    public PolymarketDataApiService(
        IHttpClientFactory httpClientFactory,
        IPolymarketWalletResolver wallet,
        ILogger<PolymarketDataApiService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _wallet = wallet;
        _logger = logger;
    }

    public string? ResolveWalletAddress() => _wallet.ResolveWalletAddress();

    public Task<bool?> TryInferOutcomeFromPositionAsync(
        string userAddress,
        string assetTokenId,
        CancellationToken ct = default) =>
        QueryAssetPositionAsync(
            userAddress,
            assetTokenId,
            InferOutcomeFromRow,
            () =>
            {
                _logger.LogDebug("No Data API position row for token {TokenId}", assetTokenId);
                return (bool?)null;
            },
            ex =>
            {
                _logger.LogWarning(ex, "Failed to fetch Polymarket positions for {User}", userAddress);
                return (bool?)null;
            },
            ct);

    public Task<bool?> TryIsOutcomeTokenRedeemableAsync(
        string userAddress,
        string assetTokenId,
        CancellationToken ct = default) =>
        QueryAssetPositionAsync(
            userAddress,
            assetTokenId,
            row => row.TryGetProperty("redeemable", out var r) && r.ValueKind == JsonValueKind.True,
            () => false,
            ex =>
            {
                _logger.LogWarning(
                    ex,
                    "Failed to check redeemable state for token {TokenId} user {User}",
                    assetTokenId,
                    userAddress);
                return null;
            },
            ct);

    private bool? InferOutcomeFromRow(JsonElement row)
    {
        var curPrice = ReadDouble(row, "curPrice");
        if (curPrice >= 0.99)
        {
            return true;
        }

        if (curPrice <= 0.01)
        {
            return false;
        }

        if (row.TryGetProperty("redeemable", out var r) && r.ValueKind == JsonValueKind.True)
        {
            return true;
        }

        var asset = row.TryGetProperty("asset", out var a) ? a.GetString()?.Trim() : null;
        _logger.LogDebug(
            "Position for token {TokenId} not clearly resolved (curPrice={CurPrice})",
            asset,
            curPrice);
        return null;
    }

    private async Task<bool?> QueryAssetPositionAsync(
        string userAddress,
        string assetTokenId,
        Func<JsonElement, bool?> onMatch,
        Func<bool?> onMissing,
        Func<Exception, bool?> onError,
        CancellationToken ct)
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

                return onMatch(row);
            }

            return onMissing();
        }
        catch (Exception ex)
        {
            return onError(ex);
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
