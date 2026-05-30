using System.Text.Json;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;

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

    public async Task PublishEntryFailedAsync(EntryFailedEvent entryFailed, CancellationToken ct = default)
    {
        if (!_telegram.IsEnabled)
        {
            return;
        }

        try
        {
            var text = FormatEntryFailed(entryFailed);
            await _telegram.NotifyAdminsAsync(text, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to format Telegram entry-failed alert");
        }
    }

    public Task PublishPositionsFeedChangedAsync(CancellationToken ct = default) =>
        Task.CompletedTask;

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

    private static string FormatEntryFailed(EntryFailedEvent e)
    {
        var market = e.MarketTitle ?? e.MarketSlug ?? "—";
        var reasonLabel = EntryFailedReasonLabel(e.SkipReason);
        var lines = new List<string>
        {
            "⚠️ Trade open failed",
            $"Mode: {e.Mode}",
            $"Reason: {reasonLabel}",
        };

        if (!string.IsNullOrWhiteSpace(e.Detail))
        {
            lines.Add($"Error: {e.Detail.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(e.Side) && !string.IsNullOrWhiteSpace(e.Trend))
        {
            lines.Add($"Side: {e.Side} ({e.Trend})");
        }

        if (e.StakeUsd is > 0)
        {
            lines.Add($"Stake: ${e.StakeUsd.Value:F2}");
        }

        lines.Add($"Market: {market}");
        lines.Add($"Candle: {FormatCandleTime(e.CandleTimeSec)}");
        return string.Join('\n', lines);
    }

    private static string EntryFailedReasonLabel(string skipReason) => skipReason switch
    {
        "order_failed" => "Live order failed",
        "insufficient_balance" => "Insufficient balance",
        "balance_unavailable" => "CLOB balance unavailable",
        "no_market" => "No active market",
        "clob_min_order_size" => "Below Polymarket min order size",
        "entry_price_out_of_range" => "No entry",
        "no_signal" => "Skip",
        "waiting_for_entry" => "Waiting for entry",
        _ => skipReason.Replace('_', ' '),
    };

    private static string FormatCandleTime(long candleTimeUnix)
    {
        try
        {
            var dto = candleTimeUnix >= 1_000_000_000_000L
                ? DateTimeOffset.FromUnixTimeMilliseconds(candleTimeUnix)
                : DateTimeOffset.FromUnixTimeSeconds(candleTimeUnix);
            return dto.UtcDateTime.ToString("yyyy-MM-dd HH:mm") + " UTC";
        }
        catch
        {
            return candleTimeUnix.ToString();
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
