using System.Text.Json;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;

namespace PolyTrader.Api.Services;

public sealed class TelegramTradingEventPublisher : ITradingEventPublisher
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly ITelegramNotifier _telegram;
    private readonly ILogger<TelegramTradingEventPublisher> _logger;

    public TelegramTradingEventPublisher(
        ITelegramNotifier telegram,
        ILogger<TelegramTradingEventPublisher> logger)
    {
        _telegram = telegram;
        _logger = logger;
    }

    public Task PublishEngineStatusAsync(bool isRunning, string mode, CancellationToken ct = default)
    {
        if (!_telegram.IsEnabled)
        {
            return Task.CompletedTask;
        }

        var icon = isRunning ? "▶️" : "⏸️";
        var state = isRunning ? "RUNNING" : "STOPPED";
        var text = $"{icon} Engine {state}\nMode: {mode}";
        return _telegram.NotifyAdminsAsync(text, ct);
    }

    public async Task PublishTradePlacedAsync(object trade, CancellationToken ct = default)
    {
        if (!_telegram.IsEnabled)
        {
            return;
        }

        try
        {
            var json = JsonSerializer.Serialize(trade);
            var payload = JsonSerializer.Deserialize<TradeAlertPayload>(json, JsonOptions);
            if (payload == null)
            {
                return;
            }

            var text = payload.Won is null
                ? FormatTradeOpened(payload)
                : FormatTradeClosed(payload);

            await _telegram.NotifyAdminsAsync(text, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to format Telegram trade alert");
        }
    }

    public Task PublishBalanceUpdatedAsync(double balance, int paperAccountId = 0, CancellationToken ct = default) =>
        Task.CompletedTask;

    public Task PublishMarketWindowUpdatedAsync(object? market, CancellationToken ct = default) =>
        Task.CompletedTask;

    public Task PublishCandleClosedAsync(long candleTime, CancellationToken ct = default) =>
        Task.CompletedTask;

    private static string FormatTradeOpened(TradeAlertPayload t)
    {
        var market = t.Market?.Title ?? t.Market?.Slug ?? "—";
        return $"""
            📈 Trade opened
            Mode: {t.Mode}
            Side: {t.Side} ({t.Trend})
            Stake: ${t.StakeUsd:F2}
            Entry: {t.EntryPrice:F4}
            Market: {market}
            Candle: {FormatCandleTime(t.CandleTime)}
            """;
    }

    private static string FormatTradeClosed(TradeAlertPayload t)
    {
        var won = t.Won == true;
        var icon = won ? "✅" : "❌";
        var market = t.Market?.Title ?? t.Market?.Slug ?? "—";
        var pnl = t.PnlUsd is double p ? $"${p:+#0.00;-#0.00;0}" : "—";
        return $"""
            {icon} Trade closed
            Mode: {t.Mode}
            Side: {t.Side} ({t.Trend})
            Result: {(won ? "WIN" : "LOSS")}
            PnL: {pnl}
            Stake: ${t.StakeUsd:F2}
            Market: {market}
            Candle: {FormatCandleTime(t.CandleTime)}
            """;
    }

    private static string FormatCandleTime(long candleTimeMs)
    {
        try
        {
            return DateTimeOffset.FromUnixTimeMilliseconds(candleTimeMs).UtcDateTime
                .ToString("yyyy-MM-dd HH:mm") + " UTC";
        }
        catch
        {
            return candleTimeMs.ToString();
        }
    }

    private sealed class TradeAlertPayload
    {
        public long CandleTime { get; set; }
        public string Side { get; set; } = "";
        public string Trend { get; set; } = "";
        public string Mode { get; set; } = "";
        public double StakeUsd { get; set; }
        public double EntryPrice { get; set; }
        public bool? Won { get; set; }
        public double? PnlUsd { get; set; }
        public TradeMarketPayload? Market { get; set; }
    }

    private sealed class TradeMarketPayload
    {
        public string? Title { get; set; }
        public string? Slug { get; set; }
    }
}
