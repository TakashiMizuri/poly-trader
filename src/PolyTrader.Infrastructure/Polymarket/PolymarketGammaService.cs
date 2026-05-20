using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

public interface IPolymarketGammaService
{
    Task<MarketEntity?> DiscoverActiveBtc5mMarketAsync(CancellationToken ct = default);
}

public sealed class PolymarketGammaService : IPolymarketGammaService
{
    private const string GammaBase = "https://gamma-api.polymarket.com";
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<PolymarketGammaService> _logger;

    public PolymarketGammaService(
        IHttpClientFactory httpClientFactory,
        IOptions<PolyTraderOptions> options,
        ILogger<PolymarketGammaService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<MarketEntity?> DiscoverActiveBtc5mMarketAsync(CancellationToken ct = default)
    {
        var client = _httpClientFactory.CreateClient();
        var slugPrefix = _options.BtcMarketSlugPrefix.ToLowerInvariant();
        var url = $"{GammaBase}/events?active=true&closed=false&limit=50";
        var json = await client.GetStringAsync(url, ct);
        using var doc = JsonDocument.Parse(json);

        JsonElement events;
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            events = doc.RootElement;
        }
        else if (doc.RootElement.TryGetProperty("data", out var data))
        {
            events = data;
        }
        else
        {
            return null;
        }

        foreach (var ev in events.EnumerateArray())
        {
            var slug = ev.TryGetProperty("slug", out var s) ? s.GetString() : null;
            var title = ev.TryGetProperty("title", out var t) ? t.GetString() : null;
            if (slug == null || !slug.Contains(slugPrefix, StringComparison.OrdinalIgnoreCase))
            {
                if (title == null || !title.Contains("btc", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
            }

            if (!ev.TryGetProperty("markets", out var markets)) continue;

            foreach (var market in markets.EnumerateArray())
            {
                var closed = market.TryGetProperty("closed", out var c) && c.GetBoolean();
                if (closed) continue;

                var conditionId = market.TryGetProperty("conditionId", out var cid)
                    ? cid.GetString()
                    : market.TryGetProperty("condition_id", out var cid2) ? cid2.GetString() : null;
                if (string.IsNullOrWhiteSpace(conditionId)) continue;

                var tokens = ParseTokenIds(market);
                if (tokens.Yes == null || tokens.No == null) continue;

                var (start, end) = ParseWindow(market, ev);

                return new MarketEntity
                {
                    ConditionId = conditionId,
                    Slug = market.TryGetProperty("slug", out var ms) ? ms.GetString() : slug,
                    Title = market.TryGetProperty("question", out var q) ? q.GetString() : title,
                    YesTokenId = tokens.Yes,
                    NoTokenId = tokens.No,
                    WindowStartUtc = start,
                    WindowEndUtc = end,
                    IsActive = true,
                    UpdatedAt = DateTime.UtcNow
                };
            }
        }

        _logger.LogWarning("No active BTC 5m market found via Gamma API");
        return null;
    }

    private static (string? Yes, string? No) ParseTokenIds(JsonElement market)
    {
        if (market.TryGetProperty("clobTokenIds", out var ids))
        {
            if (ids.ValueKind == JsonValueKind.String)
            {
                var parsed = JsonSerializer.Deserialize<string[]>(ids.GetString() ?? "[]");
                if (parsed is { Length: >= 2 })
                {
                    return (parsed[0], parsed[1]);
                }
            }
            else if (ids.ValueKind == JsonValueKind.Array && ids.GetArrayLength() >= 2)
            {
                return (ids[0].GetString(), ids[1].GetString());
            }
        }

        if (market.TryGetProperty("tokens", out var tokens) && tokens.ValueKind == JsonValueKind.Array)
        {
            string? yes = null;
            string? no = null;
            foreach (var token in tokens.EnumerateArray())
            {
                var outcome = token.TryGetProperty("outcome", out var o) ? o.GetString()?.ToLowerInvariant() : null;
                var id = token.TryGetProperty("token_id", out var tid) ? tid.GetString()
                    : token.TryGetProperty("tokenId", out var tid2) ? tid2.GetString() : null;
                if (id == null) continue;
                if (outcome is "yes" or "up") yes = id;
                if (outcome is "no" or "down") no = id;
            }

            return (yes, no);
        }

        return (null, null);
    }

    private static (DateTime? Start, DateTime? End) ParseWindow(JsonElement market, JsonElement ev)
    {
        DateTime? ParseTs(JsonElement el)
        {
            if (el.ValueKind == JsonValueKind.String)
            {
                if (DateTime.TryParse(el.GetString(), out var dt)) return dt.ToUniversalTime();
            }
            else if (el.ValueKind == JsonValueKind.Number)
            {
                var n = el.GetInt64();
                return n < 1_000_000_000_000
                    ? DateTimeOffset.FromUnixTimeSeconds(n).UtcDateTime
                    : DateTimeOffset.FromUnixTimeMilliseconds(n).UtcDateTime;
            }

            return null;
        }

        foreach (var key in new[] { "endDate", "endDateIso", "end_date" })
        {
            if (market.TryGetProperty(key, out var endEl))
            {
                var end = ParseTs(endEl);
                var start = DateTime.UtcNow;
                if (end.HasValue) start = end.Value.AddMinutes(-5);
                return (start, end);
            }
        }

        if (ev.TryGetProperty("endDate", out var evEnd))
        {
            var end = ParseTs(evEnd);
            return (end?.AddMinutes(-5), end);
        }

        var aligned = AlignTo5mWindow(DateTime.UtcNow);
        return (aligned.Start, aligned.End);
    }

    private static (DateTime Start, DateTime End) AlignTo5mWindow(DateTime utcNow)
    {
        var minute = utcNow.Minute - (utcNow.Minute % 5);
        var start = new DateTime(utcNow.Year, utcNow.Month, utcNow.Day, utcNow.Hour, minute, 0, DateTimeKind.Utc);
        return (start, start.AddMinutes(5));
    }
}
