using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;
using PolyTrader.Infrastructure.Services;
using PolyTrader.Infrastructure.Telegram;
using Telegram.Bot;
using Telegram.Bot.Polling;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace PolyTrader.Api.HostedServices;

public sealed class TelegramBotHostedService : BackgroundService
{
    private readonly ITelegramNotifier _notifier;
    private readonly PolyTraderOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly BalanceChartImageBuilder _chartBuilder;
    private readonly ILogger<TelegramBotHostedService> _logger;
    private TelegramBotClient? _bot;

    public TelegramBotHostedService(
        ITelegramNotifier notifier,
        IOptions<PolyTraderOptions> options,
        IServiceScopeFactory scopeFactory,
        BalanceChartImageBuilder chartBuilder,
        ILogger<TelegramBotHostedService> logger)
    {
        _notifier = notifier;
        _options = options.Value;
        _scopeFactory = scopeFactory;
        _chartBuilder = chartBuilder;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_notifier.IsEnabled || string.IsNullOrWhiteSpace(_options.TelegramBotToken))
        {
            _logger.LogInformation("Telegram bot disabled (set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_IDS)");
            return;
        }

        _bot = new TelegramBotClient(_options.TelegramBotToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var me = await _bot.GetMe(stoppingToken);
                _logger.LogInformation("Telegram bot started as @{Username}", me.Username);

                var receiverOptions = new ReceiverOptions
                {
                    AllowedUpdates = [UpdateType.Message],
                };

                _bot.StartReceiving(HandleUpdateAsync, HandleErrorAsync, receiverOptions, stoppingToken);

                try
                {
                    await Task.Delay(Timeout.Infinite, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // shutdown
                }

                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Telegram bot unavailable (api.telegram.org unreachable or blocked). Retrying in 60s; trading engine continues.");

                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    private async Task HandleUpdateAsync(ITelegramBotClient bot, Update update, CancellationToken ct)
    {
        if (update.Message?.Text is not { } text)
        {
            return;
        }

        var chatId = update.Message.Chat.Id;
        if (!_notifier.IsAdmin(chatId))
        {
            await _notifier.SendMessageToChatAsync(
                chatId,
                "Unauthorized. Add your numeric Telegram user ID to TELEGRAM_ADMIN_CHAT_IDS.",
                ct);
            return;
        }

        var command = text.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0]
            .Split('@')[0]
            .ToLowerInvariant();

        try
        {
            switch (command)
            {
                case "/start":
                case "/help":
                    await SendHelpAsync(chatId, ct);
                    break;
                case "/status":
                    await SendStatusAsync(chatId, ct);
                    break;
                case "/balance":
                    await SendBalanceAsync(chatId, ct);
                    break;
                case "/chart":
                    await SendChartAsync(chatId, ct);
                    break;
                case "/start_engine":
                case "/resume":
                    await SetEngineRunningAsync(chatId, true, ct);
                    break;
                case "/stop_engine":
                case "/pause":
                    await SetEngineRunningAsync(chatId, false, ct);
                    break;
                default:
                    if (command.StartsWith('/'))
                    {
                        await _notifier.SendMessageToChatAsync(chatId, "Unknown command. Send /help.", ct);
                    }

                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Telegram command failed: {Command}", command);
            await _notifier.SendMessageToChatAsync(chatId, $"Error: {ex.Message}", ct);
        }
    }

    private Task HandleErrorAsync(ITelegramBotClient bot, Exception ex, CancellationToken ct)
    {
        _logger.LogWarning(ex, "Telegram polling error");
        return Task.CompletedTask;
    }

    private async Task SendHelpAsync(long chatId, CancellationToken ct)
    {
        const string help = """
            PolyTrader operator bot

            /status — engine mode and balances
            /balance — current balances
            /chart — balance history chart (PNG)
            /start_engine or /resume — start trading engine
            /stop_engine or /pause — stop trading engine

            Alerts (trade open/close, engine state) are sent to all admin chat IDs.
            """;
        await _notifier.SendMessageToChatAsync(chatId, help, ct);
    }

    private async Task SendStatusAsync(long chatId, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var engine = scope.ServiceProvider.GetRequiredService<IEngineSettingsService>();
        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
        var clob = scope.ServiceProvider.GetRequiredService<IPolymarketClobService>();

        var settings = await engine.GetAsync(ct);
        var liveBalance = await clob.GetCollateralBalanceAsync(ct);

        var lines = new List<string>
        {
            $"Engine: {(settings.IsRunning ? "RUNNING" : "STOPPED")}",
            $"Mode: {settings.TradingMode}",
        };

        if (settings.ActivePaperAccountName is not null)
        {
            lines.Add($"Paper: {settings.ActivePaperAccountName} (${settings.ActivePaperBalance:F2})");
        }

        if (clob.IsConfigured)
        {
            lines.Add($"Live USDC: ${liveBalance?.ToString("F2") ?? "—"}");
        }

        await _notifier.SendMessageToChatAsync(chatId, string.Join('\n', lines), ct);
    }

    private async Task SendBalanceAsync(long chatId, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
        var clob = scope.ServiceProvider.GetRequiredService<IPolymarketClobService>();
        var settings = await db.EngineSettings.AsNoTracking().FirstAsync(ct);

        var liveBalance = await clob.GetCollateralBalanceAsync(ct);
        var parts = new List<string> { $"Mode: {settings.TradingMode}" };

        if (settings.ActivePaperAccountId is int paperId)
        {
            var account = await db.PaperAccounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == paperId, ct);
            if (account != null)
            {
                parts.Add($"Paper ({account.Name}): ${account.Balance:F2}");
            }
        }

        if (clob.IsConfigured)
        {
            parts.Add($"Live USDC: ${liveBalance?.ToString("F2") ?? "—"}");
        }

        await _notifier.SendMessageToChatAsync(chatId, string.Join('\n', parts), ct);
    }

    private async Task SendChartAsync(long chatId, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
        var historyService = scope.ServiceProvider.GetRequiredService<BalanceHistoryService>();
        var settings = await db.EngineSettings.AsNoTracking().FirstAsync(ct);

        var history = await historyService.BuildAsync(
            db,
            settings.TradingMode,
            settings.ActivePaperAccountId,
            limit: 200,
            ct);

        if (history.Actual.Count == 0 && history.Expected.Count == 0)
        {
            await _notifier.SendMessageToChatAsync(chatId, "No balance history yet.", ct);
            return;
        }

        var title = $"Balance — {settings.TradingMode}";
        if (settings.ActivePaperAccountId is int id)
        {
            var name = await db.PaperAccounts.AsNoTracking()
                .Where(a => a.Id == id)
                .Select(a => a.Name)
                .FirstOrDefaultAsync(ct);
            if (!string.IsNullOrWhiteSpace(name))
            {
                title += $" ({name})";
            }
        }

        var png = _chartBuilder.BuildPng(history, title);
        await _notifier.SendPhotoToChatAsync(chatId, png, title, ct);
    }

    private async Task SetEngineRunningAsync(long chatId, bool running, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var engine = scope.ServiceProvider.GetRequiredService<IEngineSettingsService>();
        var result = await engine.UpdateAsync(new UpdateEngineSettingsCommand(IsRunning: running), ct);

        if (!result.Success)
        {
            await _notifier.SendMessageToChatAsync(
                chatId,
                $"Could not {(running ? "start" : "stop")} engine: {result.ErrorMessage}",
                ct);
        }

        // Success: engine status push is sent via TelegramTradingEventPublisher.
    }
}
