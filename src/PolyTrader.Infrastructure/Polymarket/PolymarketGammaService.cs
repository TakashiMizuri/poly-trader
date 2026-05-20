using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed record Btc5mMarketWindows(MarketEntity? Current, MarketEntity? NextScheduled);

public interface IPolymarketGammaService
{
    Task<Btc5mMarketWindows> DiscoverBtc5mWindowsAsync(CancellationToken ct = default);

    Task<MarketEntity?> DiscoverActiveBtc5mMarketAsync(CancellationToken ct = default);

    /// <summary>Polymarket slug is aligned to window start unix seconds, e.g. btc-updown-5m-1779282300.</summary>
    Task<MarketEntity?> DiscoverMarketByWindowStartAsync(long windowStartUnixSeconds, CancellationToken ct = default);

    /// <summary>Recently ended BTC 5m windows (for position history), newest first.</summary>
    Task<IReadOnlyList<MarketEntity>> DiscoverPastBtc5mWindowsAsync(int count, CancellationToken ct = default);

    /// <summary>Winning side after market resolution; null if still open or unknown.</summary>
    Task<TradeSide?> TryGetResolvedWinningSideAsync(string conditionId, CancellationToken ct = default);
}

public sealed class PolymarketGammaService : IPolymarketGammaService
{
    private const string GammaBase = "https://gamma-api.polymarket.com";
    private static readonly TimeSpan CurrentEventCacheTtl = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PastWindowsCacheTtl = TimeSpan.FromSeconds(60);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<PolymarketGammaService> _logger;
    private readonly object _cacheLock = new();
    private Btc5mMarketWindows? _cachedWindows;
    private DateTime _cachedAtUtc;
    private IReadOnlyList<MarketEntity>? _cachedPastWindows;
    private int _cachedPastCount;
    private DateTime _cachedPastAtUtc;

    public PolymarketGammaService(
        IHttpClientFactory httpClientFactory,
        IOptions<PolyTraderOptions> options,
        ILogger<PolymarketGammaService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<Btc5mMarketWindows> DiscoverBtc5mWindowsAsync(CancellationToken ct = default)
    {
        lock (_cacheLock)
        {
            if (_cachedWindows != null && DateTime.UtcNow - _cachedAtUtc < CurrentEventCacheTtl)
            {
                return _cachedWindows;
            }
        }

        var seriesSlug = NormalizeSeriesSlug(_options.BtcMarketSlugPrefix);
        var (current, next) = await ResolveByComputedSlugAsync(seriesSlug, ct);
        if (current == null && next == null)
        {
            var fallback = await ResolveFromEventsListAsync(ct);
            if (fallback != null)
            {
                var now = DateTime.UtcNow;
                if (fallback.WindowStartUtc is { } start && start > now)
                {
                    next = fallback;
                }
                else
                {
                    current = fallback;
                }
            }
        }

        var windows = new Btc5mMarketWindows(current, next);
        if (current == null && next == null)
        {
            _logger.LogWarning("No BTC 5m market windows found via Gamma API");
        }

        lock (_cacheLock)
        {
            _cachedWindows = windows;
            _cachedAtUtc = DateTime.UtcNow;
        }

        return windows;
    }

    public async Task<MarketEntity?> DiscoverActiveBtc5mMarketAsync(CancellationToken ct = default)
    {
        var windows = await DiscoverBtc5mWindowsAsync(ct);
        return windows.Current ?? windows.NextScheduled;
    }

    public async Task<MarketEntity?> DiscoverMarketByWindowStartAsync(
        long windowStartUnixSeconds,
        CancellationToken ct = default)
    {
        var seriesSlug = NormalizeSeriesSlug(_options.BtcMarketSlugPrefix);
        var prefix = DeriveEventSlugPrefix(seriesSlug);
        var slug = $"{prefix}-{windowStartUnixSeconds}";
        var evt = await FetchEventBySlugAsync(slug, ct);
        if (evt == null || evt.Closed) return null;
        return MapEventToMarket(evt);
    }

    public async Task<TradeSide?> TryGetResolvedWinningSideAsync(string conditionId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(conditionId))
        {
            return null;
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"{GammaBase}/markets?condition_ids={Uri.EscapeDataString(conditionId)}";
            var json = await client.GetStringAsync(url, ct);
            using var doc = JsonDocument.Parse(json);

            JsonElement markets;
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                markets = doc.RootElement;
            }
            else if (doc.RootElement.TryGetProperty("markets", out var nested)
                     && nested.ValueKind == JsonValueKind.Array)
            {
                markets = nested;
            }
            else
            {
                return null;
            }

            foreach (var market in markets.EnumerateArray())
            {
                var closed = market.TryGetProperty("closed", out var c) && c.GetBoolean();
                if (!closed)
                {
                    continue;
                }

                var winner = ParseWinningSide(market);
                if (winner != null)
                {
                    return winner;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch Gamma resolution for condition {ConditionId}", conditionId);
        }

        return null;
    }

    public async Task<IReadOnlyList<MarketEntity>> DiscoverPastBtc5mWindowsAsync(int count, CancellationToken ct = default)
    {
        if (count <= 0) return Array.Empty<MarketEntity>();

        lock (_cacheLock)
        {
            if (_cachedPastWindows != null
                && _cachedPastCount == count
                && DateTime.UtcNow - _cachedPastAtUtc < PastWindowsCacheTtl)
            {
                return _cachedPastWindows;
            }
        }

        var seriesSlug = NormalizeSeriesSlug(_options.BtcMarketSlugPrefix);
        var prefix = DeriveEventSlugPrefix(seriesSlug);
        var now = DateTime.UtcNow;
        var aligned = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        aligned -= aligned % 300;

        var results = new List<MarketEntity>(count);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 1; i <= count && results.Count < count; i++)
        {
            var slug = $"{prefix}-{aligned - i * 300L}";
            var evt = await FetchEventBySlugAsync(slug, ct);
            if (evt == null) continue;

            var market = MapEventToMarket(evt, includeClosed: true)
                ?? MapEventToMarketForHistory(evt);
            if (market == null) continue;

            var end = market.WindowEndUtc;
            if (end == null || end > now) continue;

            if (!seen.Add(market.ConditionId)) continue;
            market.IsActive = false;
            results.Add(market);
        }

        var list = (IReadOnlyList<MarketEntity>)results;
        lock (_cacheLock)
        {
            _cachedPastWindows = list;
            _cachedPastCount = count;
            _cachedPastAtUtc = DateTime.UtcNow;
        }

        return list;
    }

    /// <summary>
    /// Gamma list endpoints often skip the live window; slug is {prefix}-{unixStart} aligned to 5 minutes.
    /// </summary>
    private async Task<(MarketEntity? Current, MarketEntity? NextScheduled)> ResolveByComputedSlugAsync(
        string seriesSlug,
        CancellationToken ct)
    {
        var prefix = DeriveEventSlugPrefix(seriesSlug);
        var now = DateTimeOffset.UtcNow;
        var aligned = now.ToUnixTimeSeconds();
        aligned -= aligned % 300;

        MarketEntity? inProgress = null;
        MarketEntity? nextScheduled = null;
        DateTime? nextStart = null;

        foreach (var offsetSeconds in new long[] { -300, 0, 300, 600 })
        {
            var slug = $"{prefix}-{aligned + offsetSeconds}";
            var evt = await FetchEventBySlugAsync(slug, ct);
            if (evt == null || evt.Closed) continue;

            var start = InferWindowStart(evt.StartTime, slug);
            var end = ParseEndDate(evt.EndDate) ?? start?.AddMinutes(5);
            if (end == null || end <= now.UtcDateTime) continue;

            var market = MapEventToMarket(evt);
            if (market == null) continue;

            if (start is { } windowStart
                && windowStart <= now.UtcDateTime
                && end > now.UtcDateTime)
            {
                inProgress = market;
                continue;
            }

            if (start is { } futureStart && futureStart > now.UtcDateTime)
            {
                if (nextStart == null || futureStart < nextStart)
                {
                    nextScheduled = market;
                    nextStart = futureStart;
                }
            }
        }

        if (inProgress != null
            && nextScheduled != null
            && string.Equals(
                inProgress.ConditionId,
                nextScheduled.ConditionId,
                StringComparison.OrdinalIgnoreCase))
        {
            nextScheduled = null;
        }

        return (inProgress, nextScheduled);
    }

    private async Task<MarketEntity?> ResolveFromEventsListAsync(CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient();
        var slugPrefix = _options.BtcMarketSlugPrefix.ToLowerInvariant();
        var url = $"{GammaBase}/events?active=true&closed=false&limit=50";
        var json = await client.GetStringAsync(url, ct);
        using var doc = JsonDocument.Parse(json);

        if (!TryGetEventArray(doc.RootElement, out var events)) return null;

        foreach (var ev in EnumerateEvents(events))
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

            var closed = ev.TryGetProperty("closed", out var c) && c.GetBoolean();
            if (closed) continue;

            var mapped = MapEventElementToMarket(ev);
            if (mapped != null) return mapped;
        }

        return null;
    }

    private async Task<GammaEventDto?> FetchEventBySlugAsync(string slug, CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient();
        var url = $"{GammaBase}/events?slug={Uri.EscapeDataString(slug)}";
        var json = await client.GetStringAsync(url, ct);
        using var doc = JsonDocument.Parse(json);

        if (!TryGetEventArray(doc.RootElement, out var events)) return null;
        foreach (var ev in EnumerateEvents(events))
        {
            var evSlug = ev.TryGetProperty("slug", out var s) ? s.GetString() : null;
            if (!string.Equals(evSlug, slug, StringComparison.OrdinalIgnoreCase)) continue;

            return new GammaEventDto
            {
                Slug = evSlug,
                Title = ev.TryGetProperty("title", out var t) ? t.GetString() : null,
                EndDate = ev.TryGetProperty("endDate", out var ed) ? ed.GetString() : null,
                StartTime = ev.TryGetProperty("startTime", out var st) ? st.GetString() : null,
                ImageUrl = ParseImageUrl(ev),
                Closed = ev.TryGetProperty("closed", out var c) && c.GetBoolean(),
                // Clone so Markets survives after JsonDocument is disposed.
                Markets = ev.TryGetProperty("markets", out var mk) ? mk.Clone() : default,
            };
        }

        return null;
    }

    private MarketEntity? MapEventToMarket(GammaEventDto evt, bool includeClosed = false)
    {
        if (evt.Markets.ValueKind != JsonValueKind.Array) return null;
        return MapEventElementToMarket(
            evt.Markets, evt.Slug, evt.Title, evt.EndDate, evt.StartTime, evt.ImageUrl, includeClosed);
    }

    /// <summary>Fallback when Gamma marks the event closed but slug/title are still available.</summary>
    private MarketEntity? MapEventToMarketForHistory(GammaEventDto evt)
    {
        if (evt.Slug == null || !TryParseUnixFromSlug(evt.Slug, out var unix)) return null;

        var start = InferWindowStart(evt.StartTime, evt.Slug)
            ?? DateTimeOffset.FromUnixTimeSeconds(unix).UtcDateTime;
        var end = ParseEndDate(evt.EndDate) ?? start.AddMinutes(5);

        string? conditionId = null;
        if (evt.Markets.ValueKind == JsonValueKind.Array)
        {
            foreach (var market in evt.Markets.EnumerateArray())
            {
                conditionId = market.TryGetProperty("conditionId", out var cid)
                    ? cid.GetString()
                    : market.TryGetProperty("condition_id", out var cid2) ? cid2.GetString() : null;
                if (!string.IsNullOrWhiteSpace(conditionId)) break;
            }
        }

        if (string.IsNullOrWhiteSpace(conditionId)) return null;

        return new MarketEntity
        {
            ConditionId = conditionId,
            Slug = evt.Slug,
            Title = evt.Title ?? "BTC Up or Down — 5 min",
            ImageUrl = evt.ImageUrl,
            YesTokenId = "",
            NoTokenId = "",
            WindowStartUtc = start,
            WindowEndUtc = end,
            IsActive = false,
            UpdatedAt = DateTime.UtcNow,
        };
    }

    private MarketEntity? MapEventElementToMarket(JsonElement ev, bool includeClosed = false)
    {
        var slug = ev.TryGetProperty("slug", out var s) ? s.GetString() : null;
        var title = ev.TryGetProperty("title", out var t) ? t.GetString() : null;
        var endDate = ev.TryGetProperty("endDate", out var ed) ? ed.GetString() : null;
        var startTime = ev.TryGetProperty("startTime", out var st) ? st.GetString() : null;
        if (!ev.TryGetProperty("markets", out var markets)) return null;
        return MapEventElementToMarket(
            markets, slug, title, endDate, startTime, ParseImageUrl(ev), includeClosed);
    }

    private MarketEntity? MapEventElementToMarket(
        JsonElement markets,
        string? eventSlug,
        string? eventTitle,
        string? eventEndDate,
        string? eventStartTime,
        string? eventImageUrl = null,
        bool includeClosed = false)
    {
        foreach (var market in markets.EnumerateArray())
        {
            var closed = market.TryGetProperty("closed", out var c) && c.GetBoolean();
            if (closed && !includeClosed) continue;

            var conditionId = market.TryGetProperty("conditionId", out var cid)
                ? cid.GetString()
                : market.TryGetProperty("condition_id", out var cid2) ? cid2.GetString() : null;
            if (string.IsNullOrWhiteSpace(conditionId)) continue;

            var tokens = ParseTokenIds(market);
            if (tokens.Yes == null || tokens.No == null) continue;

            var slug = market.TryGetProperty("slug", out var ms) ? ms.GetString() : eventSlug;
            var title = market.TryGetProperty("question", out var q) ? q.GetString() : eventTitle;
            var start = InferWindowStart(eventStartTime, slug) ?? ParseEndDate(eventEndDate)?.AddMinutes(-5);
            var end = ParseEndDate(market, eventEndDate);

            if (start == null && slug != null && TryParseUnixFromSlug(slug, out var unix))
            {
                start = DateTimeOffset.FromUnixTimeSeconds(unix).UtcDateTime;
            }

            if (end == null && start != null)
            {
                end = start.Value.AddMinutes(5);
            }

            return new MarketEntity
            {
                ConditionId = conditionId,
                Slug = slug,
                Title = title,
                ImageUrl = ParseImageUrl(market) ?? eventImageUrl,
                YesTokenId = tokens.Yes,
                NoTokenId = tokens.No,
                WindowStartUtc = start,
                WindowEndUtc = end,
                IsActive = true,
                UpdatedAt = DateTime.UtcNow,
            };
        }

        return null;
    }

    private static bool TryGetEventArray(JsonElement root, out JsonElement events)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            events = root;
            return true;
        }

        if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
        {
            events = data;
            return true;
        }

        events = default;
        return false;
    }

    private static IEnumerable<JsonElement> EnumerateEvents(JsonElement events)
    {
        if (events.ValueKind == JsonValueKind.Array)
        {
            foreach (var ev in events.EnumerateArray())
            {
                yield return ev;
            }

            yield break;
        }

        if (events.ValueKind == JsonValueKind.Object)
        {
            yield return events;
        }
    }

    private static string NormalizeSeriesSlug(string slug) =>
        slug.Replace("up-or-down", "updown", StringComparison.OrdinalIgnoreCase);

    private static string DeriveEventSlugPrefix(string seriesSlug)
    {
        if (seriesSlug.Contains("up-or-down", StringComparison.OrdinalIgnoreCase))
        {
            return seriesSlug.Replace("up-or-down", "updown", StringComparison.OrdinalIgnoreCase);
        }

        return seriesSlug.EndsWith("-5m", StringComparison.OrdinalIgnoreCase)
            ? seriesSlug
            : $"{seriesSlug.TrimEnd('-')}-updown-5m";
    }

    private static bool TryParseUnixFromSlug(string slug, out long unixSeconds)
    {
        unixSeconds = 0;
        var lastDash = slug.LastIndexOf('-');
        if (lastDash < 0 || lastDash >= slug.Length - 1) return false;
        return long.TryParse(slug[(lastDash + 1)..], out unixSeconds);
    }

    private static DateTime? InferWindowStart(string? startTime, string? slug)
    {
        var fromField = ParseEndDate(startTime);
        if (fromField != null) return fromField;

        if (slug != null && TryParseUnixFromSlug(slug, out var unix))
        {
            return DateTimeOffset.FromUnixTimeSeconds(unix).UtcDateTime;
        }

        return null;
    }

    private static DateTime? ParseEndDate(JsonElement market, string? fallbackEndDate)
    {
        foreach (var key in new[] { "endDate", "endDateIso", "end_date" })
        {
            if (market.TryGetProperty(key, out var endEl))
            {
                var end = ParseEndDate(endEl.ValueKind == JsonValueKind.String ? endEl.GetString() : null);
                if (end != null) return end;
            }
        }

        return ParseEndDate(fallbackEndDate);
    }

    private static string? ParseImageUrl(JsonElement element)
    {
        foreach (var key in new[] { "image", "icon" })
        {
            if (!element.TryGetProperty(key, out var img)) continue;
            var url = img.GetString();
            if (!string.IsNullOrWhiteSpace(url)) return url;
        }

        return null;
    }

    private static DateTime? ParseEndDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        if (DateTime.TryParse(value, out var dt))
        {
            return dt.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(dt, DateTimeKind.Utc)
                : dt.ToUniversalTime();
        }

        if (long.TryParse(value, out var n))
        {
            return n < 1_000_000_000_000
                ? DateTimeOffset.FromUnixTimeSeconds(n).UtcDateTime
                : DateTimeOffset.FromUnixTimeMilliseconds(n).UtcDateTime;
        }

        return null;
    }

    private static TradeSide? ParseWinningSide(JsonElement market)
    {
        var outcomes = ParseStringArray(market, "outcomes");
        var prices = ParseStringArray(market, "outcomePrices");
        if (outcomes.Count == 0 || prices.Count == 0 || outcomes.Count != prices.Count)
        {
            return null;
        }

        var winIndex = -1;
        for (var i = 0; i < prices.Count; i++)
        {
            if (!double.TryParse(prices[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var p))
            {
                continue;
            }

            if (p >= 0.99)
            {
                winIndex = i;
                break;
            }
        }

        if (winIndex < 0)
        {
            return null;
        }

        var label = outcomes[winIndex].ToLowerInvariant();
        if (label is "yes" or "up")
        {
            return TradeSide.Up;
        }

        if (label is "no" or "down")
        {
            return TradeSide.Down;
        }

        return null;
    }

    private static List<string> ParseStringArray(JsonElement market, string propertyName)
    {
        if (!market.TryGetProperty(propertyName, out var el))
        {
            return [];
        }

        if (el.ValueKind == JsonValueKind.Array)
        {
            return el.EnumerateArray()
                .Select(x => x.GetString() ?? "")
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList();
        }

        if (el.ValueKind == JsonValueKind.String)
        {
            var raw = el.GetString();
            if (string.IsNullOrWhiteSpace(raw))
            {
                return [];
            }

            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    return doc.RootElement.EnumerateArray()
                        .Select(x => x.GetString() ?? "")
                        .Where(s => !string.IsNullOrWhiteSpace(s))
                        .ToList();
                }
            }
            catch
            {
                // ignore malformed JSON string
            }
        }

        return [];
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

    private sealed class GammaEventDto
    {
        public string? Slug { get; init; }
        public string? Title { get; init; }
        public string? EndDate { get; init; }
        public string? StartTime { get; init; }
        public string? ImageUrl { get; init; }
        public bool Closed { get; init; }
        public JsonElement Markets { get; init; }
    }
}
