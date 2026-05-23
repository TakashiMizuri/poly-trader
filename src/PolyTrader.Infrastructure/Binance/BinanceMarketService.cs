using System.Globalization;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Binance;

public sealed class BinanceKlineClosedEventArgs : EventArgs
{
    public required ChartCandle Candle { get; init; }
    public required IReadOnlyList<ChartCandle> Buffer { get; init; }
}

public interface IBinanceMarketService
{
    BinanceConnectionStatus Status { get; }
    IReadOnlyList<ChartCandle> Candles { get; }
    double? LastPrice { get; }
    event EventHandler<BinanceKlineClosedEventArgs>? KlineClosed;
    event EventHandler? CandlesUpdated;
    Task StartAsync(CancellationToken cancellationToken = default);
    Task StopAsync();
    /// <summary>
    /// Overwrite recent bars in the in-memory buffer with Binance REST OHLC (authoritative closed values).
    /// </summary>
    Task RefreshRecentCandlesAsync(int limit = 100, CancellationToken cancellationToken = default);
}

public enum BinanceConnectionStatus
{
    Idle,
    Loading,
    Connected,
    Reconnecting,
    Disconnected,
    Error
}

public sealed class BinanceMarketService : IBinanceMarketService, IAsyncDisposable
{
    private const string RestBase = "https://api.binance.com";
    private const string WsSingle = "wss://stream.binance.com:9443/ws";
    private const int MaxReconnectDelayMs = 30_000;

    private readonly PolyTraderOptions _options;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<BinanceMarketService> _logger;
    private readonly object _lock = new();
    private readonly List<ChartCandle> _candles = [];

    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _receiveTask;
    private int _reconnectAttempt;

    public BinanceMarketService(
        IOptions<PolyTraderOptions> options,
        IHttpClientFactory httpClientFactory,
        ILogger<BinanceMarketService> logger)
    {
        _options = options.Value;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public BinanceConnectionStatus Status { get; private set; } = BinanceConnectionStatus.Idle;
    public IReadOnlyList<ChartCandle> Candles
    {
        get { lock (_lock) return _candles.ToList(); }
    }

    public double? LastPrice { get; private set; }
    public event EventHandler<BinanceKlineClosedEventArgs>? KlineClosed;
    public event EventHandler? CandlesUpdated;

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await StopAsync();
        _logger.LogInformation(
            "Binance market service starting symbol={Symbol} interval={Interval}",
            _options.BinanceSymbol,
            _options.BinanceInterval);
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        Status = BinanceConnectionStatus.Loading;
        await LoadHistoryAsync(_cts.Token);
        _logger.LogInformation("Binance history loaded: {Count} candles", Candles.Count);
        _ = RunWebSocketLoopAsync(_cts.Token);
    }

    public async Task RefreshRecentCandlesAsync(int limit = 100, CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, 1000);
        var client = _httpClientFactory.CreateClient();
        var symbol = _options.BinanceSymbol.ToUpperInvariant();
        var url =
            $"{RestBase}/api/v3/klines?symbol={symbol}&interval={_options.BinanceInterval}&limit={limit}";
        var rows = await client.GetFromJsonAsync<JsonElement[]>(url, cancellationToken);
        if (rows is not { Length: > 0 })
        {
            return;
        }

        var fresh = rows.Select(ParseKlineRow).ToList();
        lock (_lock)
        {
            foreach (var candle in fresh)
            {
                var idx = _candles.FindIndex(c => c.Time == candle.Time);
                if (idx >= 0)
                {
                    _candles[idx] = candle;
                }
                else
                {
                    _candles.Add(candle);
                }
            }

            _candles.Sort((a, b) => a.Time.CompareTo(b.Time));
            while (_candles.Count > _options.CandleHistoryLimit)
            {
                _candles.RemoveAt(0);
            }
        }

        CandlesUpdated?.Invoke(this, EventArgs.Empty);
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
        if (_receiveTask != null)
        {
            try { await _receiveTask; } catch { /* ignore */ }
        }

        Status = BinanceConnectionStatus.Disconnected;
        _logger.LogInformation("Binance market service stopped");
    }

    private async Task LoadHistoryAsync(CancellationToken ct)
    {
        const int pageSize = 1000;
        var client = _httpClientFactory.CreateClient();
        var symbol = _options.BinanceSymbol.ToUpperInvariant();
        var target = Math.Max(1, _options.CandleHistoryLimit);
        var merged = new List<ChartCandle>();
        long? endTimeMs = null;

        while (merged.Count < target)
        {
            var batchLimit = Math.Min(pageSize, target - merged.Count);
            var url =
                $"{RestBase}/api/v3/klines?symbol={symbol}&interval={_options.BinanceInterval}&limit={batchLimit}";
            if (endTimeMs.HasValue)
            {
                url += $"&endTime={endTimeMs.Value}";
            }

            var rows = await client.GetFromJsonAsync<JsonElement[]>(url, ct);
            if (rows is not { Length: > 0 })
            {
                break;
            }

            var batch = rows.Select(ParseKlineRow).ToList();
            merged.InsertRange(0, batch);
            endTimeMs = batch[0].Time * 1000 - 1;
            if (rows.Length < batchLimit)
            {
                break;
            }
        }

        if (merged.Count > target)
        {
            merged = merged.Skip(merged.Count - target).ToList();
        }

        if (merged.Count == 0)
        {
            throw new InvalidOperationException("Empty kline history");
        }

        lock (_lock)
        {
            _candles.Clear();
            _candles.AddRange(merged);
        }

        CandlesUpdated?.Invoke(this, EventArgs.Empty);
    }

    private async Task RunWebSocketLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectAndReceiveAsync(ct);
                _reconnectAttempt = 0;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Binance WS error");
                Status = BinanceConnectionStatus.Error;
            }

            if (ct.IsCancellationRequested) break;

            Status = BinanceConnectionStatus.Reconnecting;
            var delay = Math.Min(MaxReconnectDelayMs, (int)Math.Pow(2, _reconnectAttempt) * 1000);
            _reconnectAttempt++;
            await Task.Delay(delay, ct);
        }
    }

    private async Task ConnectAndReceiveAsync(CancellationToken ct)
    {
        _ws?.Dispose();
        _ws = new ClientWebSocket();
        var symbol = _options.BinanceSymbol.ToLowerInvariant();
        var stream = $"{symbol}@kline_{_options.BinanceInterval}";
        var uri = new Uri($"{WsSingle}/{stream}");
        await _ws.ConnectAsync(uri, ct);
        Status = BinanceConnectionStatus.Connected;
        _logger.LogInformation("Binance WebSocket connected stream={Stream}", stream);

        var buffer = new byte[8192];
        while (_ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await _ws.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close) break;

            var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
            ProcessMessage(json);
        }
    }

    private void ProcessMessage(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("k", out var k)) return;

        var candle = new ChartCandle
        {
            Time = k.GetProperty("t").GetInt64() / 1000,
            Open = double.Parse(k.GetProperty("o").GetString()!, CultureInfo.InvariantCulture),
            High = double.Parse(k.GetProperty("h").GetString()!, CultureInfo.InvariantCulture),
            Low = double.Parse(k.GetProperty("l").GetString()!, CultureInfo.InvariantCulture),
            Close = double.Parse(k.GetProperty("c").GetString()!, CultureInfo.InvariantCulture)
        };

        LastPrice = candle.Close;
        var isClosed = k.GetProperty("x").GetBoolean();

        IReadOnlyList<ChartCandle> snapshot;
        lock (_lock)
        {
            var idx = _candles.FindIndex(c => c.Time == candle.Time);
            if (idx >= 0) _candles[idx] = candle;
            else _candles.Add(candle);

            _candles.Sort((a, b) => a.Time.CompareTo(b.Time));
            while (_candles.Count > _options.CandleHistoryLimit)
            {
                _candles.RemoveAt(0);
            }

            snapshot = _candles.ToList();
        }

        CandlesUpdated?.Invoke(this, EventArgs.Empty);

        if (isClosed)
        {
            _logger.LogInformation(
                "Binance kline closed {Time} O={Open} H={High} L={Low} C={Close}",
                candle.Time,
                candle.Open,
                candle.High,
                candle.Low,
                candle.Close);
            KlineClosed?.Invoke(this, new BinanceKlineClosedEventArgs
            {
                Candle = candle,
                Buffer = snapshot
            });
        }
    }

    private static ChartCandle ParseKlineRow(JsonElement row)
    {
        return new ChartCandle
        {
            Time = row[0].GetInt64() / 1000,
            Open = double.Parse(row[1].GetString()!, CultureInfo.InvariantCulture),
            High = double.Parse(row[2].GetString()!, CultureInfo.InvariantCulture),
            Low = double.Parse(row[3].GetString()!, CultureInfo.InvariantCulture),
            Close = double.Parse(row[4].GetString()!, CultureInfo.InvariantCulture)
        };
    }

    public async ValueTask DisposeAsync() => await StopAsync();
}

internal sealed class BinanceCombinedMessage
{
    [JsonPropertyName("stream")]
    public string? Stream { get; set; }

    [JsonPropertyName("data")]
    public JsonElement Data { get; set; }
}
