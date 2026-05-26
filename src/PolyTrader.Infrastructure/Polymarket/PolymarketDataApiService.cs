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

    /// <summary>
    /// Fetches wallet activity from the Data API (paginated). Requires configured wallet.
    /// </summary>
    Task<IReadOnlyList<PolymarketActivityEvent>> FetchActivityAsync(
        long startUnixSeconds,
        long? endUnixSeconds = null,
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

    public async Task<IReadOnlyList<PolymarketActivityEvent>> FetchActivityAsync(
        long startUnixSeconds,
        long? endUnixSeconds = null,
        CancellationToken ct = default)
    {
        var wallet = ResolveWalletAddress();
        if (string.IsNullOrWhiteSpace(wallet))
        {
            return [];
        }

        const int limit = 500;
        var offset = 0;
        var results = new List<PolymarketActivityEvent>();

        try
        {
            var client = _httpClientFactory.CreateClient();
            while (true)
            {
                var url =
                    $"{DataApiBase}/activity?user={Uri.EscapeDataString(wallet)}&start={startUnixSeconds}&limit={limit}&offset={offset}&sortBy=TIMESTAMP&sortDirection=ASC";
                if (endUnixSeconds is long end)
                {
                    url += $"&end={end}";
                }

                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.TryAddWithoutValidation("User-Agent", "PolyTrader/1.0 (activity)");

                using var response = await client.SendAsync(request, ct);
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning(
                        "Activity API returned {Status} for user {User} offset={Offset}",
                        (int)response.StatusCode,
                        wallet,
                        offset);
                    break;
                }

                var json = await response.Content.ReadAsStringAsync(ct);
                var page = ParseActivityPage(json);
                if (page.Count == 0)
                {
                    break;
                }

                results.AddRange(page);
                if (page.Count < limit)
                {
                    break;
                }

                offset += limit;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch Polymarket activity for {User}", wallet);
            return results;
        }

        return results;
    }

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

    private static List<PolymarketActivityEvent> ParseActivityPage(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var list = new List<PolymarketActivityEvent>();
        foreach (var row in doc.RootElement.EnumerateArray())
        {
            var ts = row.TryGetProperty("timestamp", out var tsEl) ? ReadLong(tsEl) : 0L;
            if (ts > 1_000_000_000_000)
            {
                ts /= 1000;
            }

            list.Add(new PolymarketActivityEvent(
                ts,
                row.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null,
                row.TryGetProperty("side", out var sideEl) ? sideEl.GetString() : null,
                ReadDouble(row, "usdcSize"),
                row.TryGetProperty("conditionId", out var condEl) ? condEl.GetString() : null,
                row.TryGetProperty("eventSlug", out var evSlugEl) ? evSlugEl.GetString() : null,
                row.TryGetProperty("slug", out var slugEl) ? slugEl.GetString() : null));
        }

        return list;
    }

    private static long ReadLong(JsonElement el) =>
        el.ValueKind switch
        {
            JsonValueKind.Number => el.TryGetInt64(out var v) ? v : (long)el.GetDouble(),
            JsonValueKind.String => long.TryParse(
                el.GetString(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var v)
                ? v
                : 0L,
            _ => 0L,
        };

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
