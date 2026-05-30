using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace PolyTrader.Infrastructure.Polymarket;

public interface IPolymarketUserWebSocket
{
    bool IsConnected { get; }
    Task EnsureSubscribedAsync(string conditionId, CancellationToken ct = default);
    Task StopAsync();
}

/// <summary>
/// Authenticated CLOB user channel for order fill updates.
/// See https://docs.polymarket.com/market-data/websocket/user-channel
/// </summary>
public sealed class PolymarketUserWebSocket : IPolymarketUserWebSocket, IAsyncDisposable
{
    private const string WsUrl = "wss://ws-subscriptions-clob.polymarket.com/ws/user";
    private const int MaxReconnectDelayMs = 30_000;

    private readonly IPolymarketRestTradingClient _trading;
    private readonly IPolymarketOrderFillNotifier _fills;
    private readonly ILogger<PolymarketUserWebSocket> _logger;
    private readonly object _sync = new();
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _receiveTask;
    private Task? _pingTask;
    private int _reconnectAttempt;
    private PolymarketWsApiAuth? _auth;
    private readonly HashSet<string> _conditionIds = new(StringComparer.OrdinalIgnoreCase);
    private string? _pendingConditionId;

    public PolymarketUserWebSocket(
        IPolymarketRestTradingClient trading,
        IPolymarketOrderFillNotifier fills,
        ILogger<PolymarketUserWebSocket> logger)
    {
        _trading = trading;
        _fills = fills;
        _logger = logger;
    }

    public bool IsConnected { get; private set; }

    public async Task EnsureSubscribedAsync(string conditionId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(conditionId) || !_trading.IsConfigured)
        {
            return;
        }

        lock (_sync)
        {
            if (_conditionIds.Contains(conditionId) && IsConnected)
            {
                return;
            }

            _pendingConditionId = conditionId;
        }

        var auth = await _trading.TryGetWsAuthAsync(ct);
        if (auth == null)
        {
            _logger.LogDebug("User WS skipped: L2 API credentials unavailable");
            return;
        }

        lock (_sync)
        {
            _auth = auth;
            if (IsConnected && _ws?.State == WebSocketState.Open)
            {
                _ = SendSubscribeOperationAsync(conditionId, ct);
                _conditionIds.Add(conditionId);
                _pendingConditionId = null;
                return;
            }
        }

        await StopAsync();
        lock (_sync)
        {
            _conditionIds.Clear();
            _conditionIds.Add(conditionId);
            _pendingConditionId = null;
        }

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = RunLoopAsync(_cts.Token);
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
                _logger.LogWarning(ex, "Polymarket user WS error");
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
        PolymarketWsApiAuth? auth;
        string[] markets;
        lock (_sync)
        {
            auth = _auth;
            markets = _conditionIds.Count > 0
                ? _conditionIds.ToArray()
                : _pendingConditionId != null
                    ? [_pendingConditionId]
                    : [];
        }

        if (auth == null || markets.Length == 0)
        {
            return;
        }

        _ws?.Dispose();
        _ws = new ClientWebSocket();
        await _ws.ConnectAsync(new Uri(WsUrl), ct);

        var sub = JsonSerializer.Serialize(new
        {
            auth = new
            {
                apiKey = auth.ApiKey,
                secret = auth.Secret,
                passphrase = auth.Passphrase,
            },
            markets,
            type = "user",
        });
        await SendTextAsync(sub, ct);
        IsConnected = true;
        _logger.LogInformation(
            "Polymarket user WS connected, markets={Count}",
            markets.Length);

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

    private async Task SendSubscribeOperationAsync(string conditionId, CancellationToken ct)
    {
        var msg = JsonSerializer.Serialize(new
        {
            markets = new[] { conditionId },
            operation = "subscribe",
        });
        await SendTextAsync(msg, ct);
        _logger.LogDebug("User WS dynamic subscribe condition {ConditionId}", conditionId);
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
            _logger.LogDebug(ex, "Failed to parse Polymarket user WS message");
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

        if (!string.Equals(eventType, "order", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var orderId = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        if (string.IsNullOrWhiteSpace(orderId))
        {
            return;
        }

        if (!root.TryGetProperty("size_matched", out var sm))
        {
            return;
        }

        var matched = ParseAmount(sm);
        if (matched > 0)
        {
            _fills.NotifyOrderUpdate(orderId, matched);
        }
    }

    private static double ParseAmount(JsonElement el) =>
        el.ValueKind switch
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
