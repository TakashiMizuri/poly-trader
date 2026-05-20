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



    public double? Mid =>

        BestBid.HasValue && BestAsk.HasValue

            ? (BestBid.Value + BestAsk.Value) / 2

            : LastTradePrice;



    /// <summary>Price to simulate a market buy (pay the ask).</summary>

    public double? BuyPrice => BestAsk ?? LastTradePrice ?? BestBid;

}



public sealed class MarketPriceState

{

    private readonly ConcurrentDictionary<string, TokenPriceState> _byAsset = new(StringComparer.Ordinal);



    public TokenPriceState GetOrCreate(string assetId) =>

        _byAsset.GetOrAdd(assetId, _ => new TokenPriceState());



    public double? GetMid(string assetId) => GetOrCreate(assetId).Mid;



    public double? GetBuyPrice(string assetId) => GetOrCreate(assetId).BuyPrice;



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

    private ClientWebSocket? _ws;

    private CancellationTokenSource? _cts;

    private Task? _receiveTask;

    private Task? _pingTask;

    private int _reconnectAttempt;

    private string[] _assetIds = [];



    public PolymarketMarketWebSocket(ILogger<PolymarketMarketWebSocket> logger) => _logger = logger;



    public MarketPriceState Prices { get; } = new();

    public bool IsConnected { get; private set; }

    public event EventHandler? PricesUpdated;

    public event EventHandler<string>? MarketResolved;



    public async Task SubscribeAsync(string yesTokenId, string noTokenId, CancellationToken ct = default)

    {

        await StopAsync();

        Prices.Clear();

        _assetIds = [yesTokenId, noTokenId];

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        _ = RunLoopAsync(_cts.Token);

    }



    public async Task StopAsync()

    {

        _cts?.Cancel();

        if (_ws is { State: WebSocketState.Open })

        {

            try { await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "stop", CancellationToken.None); }

            catch { /* ignore */ }

        }



        _ws?.Dispose();

        _ws = null;

        IsConnected = false;

        if (_receiveTask != null)

        {

            try { await _receiveTask; } catch { /* ignore */ }

        }



        if (_pingTask != null)

        {

            try { await _pingTask; } catch { /* ignore */ }

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



            if (ct.IsCancellationRequested) break;

            var delay = Math.Min(MaxReconnectDelayMs, (int)Math.Pow(2, _reconnectAttempt) * 1000);

            _reconnectAttempt++;

            await Task.Delay(delay, ct);

        }

    }



    private async Task ConnectAsync(CancellationToken ct)

    {

        _ws?.Dispose();

        _ws = new ClientWebSocket();

        await _ws.ConnectAsync(new Uri(WsUrl), ct);



        var sub = JsonSerializer.Serialize(new

        {

            assets_ids = _assetIds,

            type = "market",

            custom_feature_enabled = true

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

            if (result.MessageType == WebSocketMessageType.Close) break;

            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);

            if (text == "PONG") continue;

            ProcessMessage(text);

        }

    }



    private void ProcessMessage(string json)

    {

        try

        {

            using var doc = JsonDocument.Parse(json);

            var root = doc.RootElement;

            var eventType = root.TryGetProperty("event_type", out var et) ? et.GetString()

                : root.TryGetProperty("type", out var t) ? t.GetString() : null;



            var assetId = root.TryGetProperty("asset_id", out var a) ? a.GetString() : null;



            switch (eventType)

            {

                case "best_bid_ask":

                    if (string.IsNullOrEmpty(assetId)) break;

                    var state = Prices.GetOrCreate(assetId);

                    if (root.TryGetProperty("best_bid", out var bid))

                        state.BestBid = double.Parse(bid.GetString() ?? "0", CultureInfo.InvariantCulture);

                    if (root.TryGetProperty("best_ask", out var ask))

                        state.BestAsk = double.Parse(ask.GetString() ?? "0", CultureInfo.InvariantCulture);

                    PricesUpdated?.Invoke(this, EventArgs.Empty);

                    break;

                case "last_trade_price":

                    if (string.IsNullOrEmpty(assetId)) break;

                    var tradeState = Prices.GetOrCreate(assetId);

                    if (root.TryGetProperty("price", out var p))

                        tradeState.LastTradePrice = double.Parse(p.GetString() ?? "0", CultureInfo.InvariantCulture);

                    PricesUpdated?.Invoke(this, EventArgs.Empty);

                    break;

                case "market_resolved":

                    MarketResolved?.Invoke(this, assetId ?? "");

                    break;

            }

        }

        catch (Exception ex)

        {

            _logger.LogDebug(ex, "Failed to parse Polymarket WS message");

        }

    }



    private async Task SendTextAsync(string text, CancellationToken ct)

    {

        if (_ws?.State != WebSocketState.Open) return;

        var bytes = Encoding.UTF8.GetBytes(text);

        await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);

    }



    public async ValueTask DisposeAsync() => await StopAsync();

}

