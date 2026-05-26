using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Api.Hubs;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Api.Services;

public sealed class SignalRTradingEventPublisher : ITradingEventPublisher
{
    private readonly IHubContext<TradingHub> _hub;
    private readonly ILogger<SignalRTradingEventPublisher> _logger;

    public SignalRTradingEventPublisher(
        IHubContext<TradingHub> hub,
        ILogger<SignalRTradingEventPublisher> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public Task PublishEngineStatusAsync(bool isRunning, string mode, CancellationToken ct = default)
    {
        _logger.LogInformation("SignalR EngineStatus running={Running} mode={Mode}", isRunning, mode);
        return _hub.Clients.All.SendAsync("EngineStatus", new { isRunning, mode }, ct);
    }

    public Task PublishTradePlacedAsync(object trade, CancellationToken ct = default)
    {
        _logger.LogInformation("SignalR TradePlaced payload={Payload}", trade);
        return _hub.Clients.All.SendAsync("TradePlaced", trade, ct);
    }

    public Task PublishEntryFailedAsync(EntryFailedEvent entryFailed, CancellationToken ct = default) =>
        Task.CompletedTask;

    public Task PublishBalanceUpdatedAsync(double balance, int paperAccountId = 0, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "SignalR BalanceUpdated account={AccountId} balance=${Balance:F2}",
            paperAccountId,
            balance);
        return _hub.Clients.All.SendAsync("BalanceUpdated", new { balance, paperAccountId }, ct);
    }

    public Task PublishMarketWindowUpdatedAsync(object? market, CancellationToken ct = default)
    {
        _logger.LogInformation("SignalR MarketWindowUpdated");
        return _hub.Clients.All.SendAsync("MarketWindowUpdated", market, ct);
    }

    public Task PublishCandleClosedAsync(long candleTime, CancellationToken ct = default)
    {
        _logger.LogDebug("SignalR CandleClosed time={CandleTime}", candleTime);
        return _hub.Clients.All.SendAsync("CandleClosed", new { candleTime }, ct);
    }
}

public static class TradeMapper
{
    public static object ToDto(TradeEntity t) => new
    {
        t.Id,
        t.CandleTime,
        side = t.Side.ToString(),
        trend = t.Trend.ToString(),
        mode = t.Mode.ToString(),
        t.StakeUsd,
        t.RequestedStakeUsd,
        isPartialFill = t.RequestedStakeUsd is > 0
            && t.RequestedStakeUsd.Value > t.StakeUsd + 0.01,
        t.StakeBalanceUsd,
        betStakeMode = t.BetStakeMode?.ToString(),
        t.BetStakePercent,
        t.BetStakeFixedUsd,
        t.EntryPrice,
        entryShares = TrendBetStrategySimulator.ComputeEntryShares(t.StakeUsd, t.EntryPrice),
        t.Won,
        t.PnlUsd,
        t.WinPayoutRatio,
        t.PaperAccountId,
        t.PolymarketOrderId,
        entryWaves = TradeEntryWavesJson.Deserialize(t.EntryWavesJson)?.Select(w => new
        {
            wave = w.Wave,
            label = w.Label,
            requestedUsd = w.RequestedUsd,
            filledUsd = w.FilledUsd,
            fillPercent = w.FillPercent,
            entryPrice = w.EntryPrice,
            orderId = w.OrderId,
        }),
        market = t.Market == null
            ? null
            : new
            {
                t.Market.Title,
                t.Market.Slug,
                windowStartUtc = t.Market.WindowStartUtc,
                windowEndUtc = t.Market.WindowEndUtc,
            },
        t.CreatedAt,
    };
}
