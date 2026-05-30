using System.Collections.Concurrent;
using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class TokenPriceState
{
    public double? BestBid { get; set; }
    public double? BestAsk { get; set; }
    public double? LastTradePrice { get; set; }
    public DateTime? LastQuoteUtc { get; set; }

    public double? Mid =>
        BestBid.HasValue && BestAsk.HasValue
            ? (BestBid.Value + BestAsk.Value) / 2
            : LastTradePrice;

    public double? BuyPrice => BestAsk ?? LastTradePrice ?? BestBid;

    public double? MakerBuyPrice =>
        BestBid
        ?? (LastTradePrice is { } lt && (!BestAsk.HasValue || lt < BestAsk.Value) ? lt : null);

    public void TouchQuote()
    {
        LastQuoteUtc = DateTime.UtcNow;
    }
}

public sealed class MarketPriceState
{
    private readonly ConcurrentDictionary<string, TokenPriceState> _byAsset = new(StringComparer.Ordinal);

    public TokenPriceState GetOrCreate(string assetId) =>
        _byAsset.GetOrAdd(assetId, _ => new TokenPriceState());

    public double? GetMid(string assetId) => GetOrCreate(assetId).Mid;

    public double? GetBuyPrice(string assetId) => GetOrCreate(assetId).BuyPrice;

    public bool TryGetFreshQuote(string assetId, TimeSpan maxAge, out double bid, out double ask)
    {
        bid = 0;
        ask = 0;
        var state = GetOrCreate(assetId);
        if (state.LastQuoteUtc is not { } at || DateTime.UtcNow - at > maxAge)
        {
            return false;
        }

        if (state.BestBid is not > 0 and <= 1 || state.BestAsk is not > 0 and <= 1)
        {
            return false;
        }

        bid = state.BestBid!.Value;
        ask = state.BestAsk!.Value;
        return true;
    }

    public void Clear() => _byAsset.Clear();
}

public interface IPolymarketMarketWebSocket
{
    MarketPriceState Prices { get; }
    bool IsConnected { get; }
    event EventHandler? PricesUpdated;
    event EventHandler<string>? MarketResolved;
    Task SubscribeAsync(string yesTokenId, string noTokenId, CancellationToken ct = default);
    Task StopAsync();
}

public sealed class PolymarketMarketWebSocket : IPolymarketMarketWebSocket, IAsyncDisposable
{
    private const string WsUrl = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
    private const int MaxReconnectDelayMs = 30_000;

    private readonly ILogger<PolymarketMarketWebSocket> _logger;
    private readonly object _sync = new();
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _receiveTask;
    private Task? _pingTask;
    private int _reconnectAttempt;
    private readonly HashSet<string> _assetIds = new(StringComparer.Ordinal);

    public PolymarketMarketWebSocket(ILogger<PolymarketMarketWebSocket> logger) => _logger = logger;

    public MarketPriceState Prices { get; } = new();
    public bool IsConnected { get; private set; }
    public event EventHandler? PricesUpdated;
    public event EventHandler<string>? MarketResolved;

    public async Task SubscribeAsync(string yesTokenId, string noTokenId, CancellationToken ct = default)
    {
        var nextIds = new[] { yesTokenId, noTokenId };
        lock (_sync)
        {
            if (_assetIds.SetEquals(nextIds) && IsConnected && _ws?.State == WebSocketState.Open)
            {
                return;
            }

            if (IsConnected && _ws?.State == WebSocketState.Open)
            {
                var toAdd = nextIds.Where(id => !_assetIds.Contains(id)).ToArray();
                var toRemove = _assetIds.Where(id => !nextIds.Contains(id)).ToArray();
                if (toAdd.Length > 0 || toRemove.Length > 0)
                {
                    _ = ApplyDynamicSubscriptionAsync(toAdd, toRemove, ct);
                    _assetIds.Clear();
                    foreach (var id in nextIds)
                    {
                        _assetIds.Add(id);
                    }

                    return;
                }
            }
        }

        await StopAsync();
        Prices.Clear();
        lock (_sync)
        {
            _assetIds.Clear();
            foreach (var id in nextIds)
            {
                _assetIds.Add(id);
            }
        }

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = RunLoopAsync(_cts.Token);
    }

    private async Task ApplyDynamicSubscriptionAsync(
        string[] toAdd,
        string[] toRemove,
        CancellationToken ct)
    {
        try
        {
            if (toRemove.Length > 0)
            {
                var unsub = JsonSerializer.Serialize(new
                {
                    assets_ids = toRemove,
                    operation = "unsubscribe",
                });
                await SendTextAsync(unsub, ct);
            }

            if (toAdd.Length > 0)
            {
                var sub = JsonSerializer.Serialize(new
                {
                    assets_ids = toAdd,
                    operation = "subscribe",
                    custom_feature_enabled = true,
                });
                await SendTextAsync(sub, ct);
            }

            _logger.LogDebug(
                "Market WS dynamic subscription +{Add} -{Remove}",
                toAdd.Length,
                toRemove.Length);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Market WS dynamic subscription failed; will reconnect on next cycle");
        }
    }

    public async Task StopAsync()
    {
        _cts?.Cancel();
        if (_ws is { State: WebSocketState.Open })
        {
            try
            {
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "stop", CancellationToken.None);
            }
            catch
            {
                // ignore
            }
        }

        _ws?.Dispose();
        _ws = null;
        IsConnected = false;

        if (_receiveTask != null)
        {
            try
            {
                await _receiveTask;
            }
            catch
            {
                // ignore
            }
        }

        if (_pingTask != null)
        {
            try
            {
                await _pingTask;
            }
            catch
            {
                // ignore
            }
        }
    }

    private async Task RunLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectAsync(ct);
                _reconnectAttempt = 0;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Polymarket market WS error");
            }

            if (ct.IsCancellationRequested)
            {
                break;
            }

            var delay = Math.Min(MaxReconnectDelayMs, (int)Math.Pow(2, _reconnectAttempt) * 1000);
            _reconnectAttempt++;
            await Task.Delay(delay, ct);
        }
    }

    private async Task ConnectAsync(CancellationToken ct)
    {
        string[] assetIds;
        lock (_sync)
        {
            assetIds = _assetIds.ToArray();
        }

        if (assetIds.Length == 0)
        {
            return;
        }

        _ws?.Dispose();
        _ws = new ClientWebSocket();
        await _ws.ConnectAsync(new Uri(WsUrl), ct);

        var sub = JsonSerializer.Serialize(new
        {
            assets_ids = assetIds,
            type = "market",
            custom_feature_enabled = true,
        });
        await SendTextAsync(sub, ct);
        IsConnected = true;

        _pingTask = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested && _ws?.State == WebSocketState.Open)
            {
                await SendTextAsync("PING", ct);
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
            }
        }, ct);

        _receiveTask = ReceiveLoopAsync(ct);
        await _receiveTask;
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[16384];
        while (_ws?.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await _ws.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                break;
            }

            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (text == "PONG")
            {
                continue;
            }

            ProcessMessage(text);
        }
    }

    private void ProcessMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in root.EnumerateArray())
                {
                    ProcessMessageElement(item);
                }

                return;
            }

            ProcessMessageElement(root);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to parse Polymarket WS message");
        }
    }

    private void ProcessMessageElement(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var eventType = root.TryGetProperty("event_type", out var et) ? et.GetString()
            : root.TryGetProperty("type", out var t) ? t.GetString() : null;

        var assetId = root.TryGetProperty("asset_id", out var a) ? a.GetString() : null;

        switch (eventType)
        {
            case "best_bid_ask":
                if (string.IsNullOrEmpty(assetId))
                {
                    break;
                }

                var state = Prices.GetOrCreate(assetId);
                if (root.TryGetProperty("best_bid", out var bid))
                {
                    state.BestBid = ParsePrice(bid);
                }

                if (root.TryGetProperty("best_ask", out var ask))
                {
                    state.BestAsk = ParsePrice(ask);
                }

                state.TouchQuote();
                PricesUpdated?.Invoke(this, EventArgs.Empty);
                break;

            case "book":
                ApplyBookSnapshot(root, assetId);
                break;

            case "price_change":
                ApplyPriceChange(root, assetId);
                break;

            case "last_trade_price":
                if (string.IsNullOrEmpty(assetId))
                {
                    break;
                }

                var tradeState = Prices.GetOrCreate(assetId);
                if (root.TryGetProperty("price", out var p))
                {
                    tradeState.LastTradePrice = ParsePrice(p);
                }

                tradeState.TouchQuote();
                PricesUpdated?.Invoke(this, EventArgs.Empty);
                break;

            case "market_resolved":
                MarketResolved?.Invoke(this, assetId ?? "");
                break;
        }
    }

    private void ApplyBookSnapshot(JsonElement root, string? assetId)
    {
        if (string.IsNullOrEmpty(assetId))
        {
            assetId = root.TryGetProperty("asset_id", out var a) ? a.GetString() : null;
        }

        if (string.IsNullOrEmpty(assetId))
        {
            return;
        }

        var state = Prices.GetOrCreate(assetId);
        if (root.TryGetProperty("bids", out var bids) && bids.ValueKind == JsonValueKind.Array)
        {
            state.BestBid = BestLevelPrice(bids, takeMax: true);
        }

        if (root.TryGetProperty("asks", out var asks) && asks.ValueKind == JsonValueKind.Array)
        {
            state.BestAsk = BestLevelPrice(asks, takeMax: false);
        }

        state.TouchQuote();
        PricesUpdated?.Invoke(this, EventArgs.Empty);
    }

    private void ApplyPriceChange(JsonElement root, string? assetId)
    {
        if (string.IsNullOrEmpty(assetId))
        {
            return;
        }

        var state = Prices.GetOrCreate(assetId);
        if (root.TryGetProperty("best_bid", out var bid))
        {
            state.BestBid = ParsePrice(bid);
        }

        if (root.TryGetProperty("best_ask", out var ask))
        {
            state.BestAsk = ParsePrice(ask);
        }

        if (state.BestBid is > 0 || state.BestAsk is > 0)
        {
            state.TouchQuote();
            PricesUpdated?.Invoke(this, EventArgs.Empty);
        }
    }

    private static double? BestLevelPrice(JsonElement levels, bool takeMax)
    {
        double? best = null;
        foreach (var level in levels.EnumerateArray())
        {
            if (!level.TryGetProperty("price", out var priceEl))
            {
                continue;
            }

            var price = ParsePrice(priceEl);
            if (price is not > 0 and <= 1)
            {
                continue;
            }

            best = best is null
                ? price
                : takeMax
                    ? Math.Max(best!.Value, price!.Value)
                    : Math.Min(best!.Value, price!.Value);
        }

        return best;
    }

    private static double? ParsePrice(JsonElement el) =>
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

    private async Task SendTextAsync(string text, CancellationToken ct)
    {
        if (_ws?.State != WebSocketState.Open)
        {
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(text);
        await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    public async ValueTask DisposeAsync() => await StopAsync();
}
