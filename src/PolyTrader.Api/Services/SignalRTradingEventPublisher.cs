using Microsoft.AspNetCore.SignalR;
using PolyTrader.Core.Abstractions;
using PolyTrader.Api.Hubs;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Api.Services;

public sealed class SignalRTradingEventPublisher : ITradingEventPublisher
{
    private readonly IHubContext<TradingHub> _hub;

    public SignalRTradingEventPublisher(IHubContext<TradingHub> hub) => _hub = hub;

    public Task PublishEngineStatusAsync(bool isRunning, string mode, CancellationToken ct = default) =>
        _hub.Clients.All.SendAsync("EngineStatus", new { isRunning, mode }, ct);

    public Task PublishTradePlacedAsync(object trade, CancellationToken ct = default) =>
        _hub.Clients.All.SendAsync("TradePlaced", trade, ct);

    public Task PublishBalanceUpdatedAsync(double balance, int paperAccountId = 0, CancellationToken ct = default) =>
        _hub.Clients.All.SendAsync("BalanceUpdated", new { balance, paperAccountId }, ct);

    public Task PublishMarketWindowUpdatedAsync(object? market, CancellationToken ct = default) =>
        _hub.Clients.All.SendAsync("MarketWindowUpdated", market, ct);

    public Task PublishCandleClosedAsync(long candleTime, CancellationToken ct = default) =>
        _hub.Clients.All.SendAsync("CandleClosed", new { candleTime }, ct);
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
        t.EntryPrice,
        t.Won,
        t.PnlUsd,
        t.PaperAccountId,
        t.CreatedAt
    };
}
