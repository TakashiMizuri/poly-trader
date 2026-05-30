using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;

namespace PolyTrader.Api.Services;

/// <summary>
/// Fan-out trading events to SignalR, Telegram, and any future publishers.
/// </summary>
public sealed class CompositeTradingEventPublisher : ITradingEventPublisher
{
    private readonly IReadOnlyList<ITradingEventPublisher> _publishers;

    public CompositeTradingEventPublisher(IEnumerable<ITradingEventPublisher> publishers)
    {
        _publishers = publishers.ToList();
    }

    public Task PublishEngineStatusAsync(bool isRunning, string mode, CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishEngineStatusAsync(isRunning, mode, ct)));

    public Task PublishTradePlacedAsync(object trade, CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishTradePlacedAsync(trade, ct)));

    public Task PublishEntryFailedAsync(EntryFailedEvent entryFailed, CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishEntryFailedAsync(entryFailed, ct)));

    public Task PublishPositionsFeedChangedAsync(CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishPositionsFeedChangedAsync(ct)));

    public Task PublishBalanceUpdatedAsync(double balance, int paperAccountId = 0, CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishBalanceUpdatedAsync(balance, paperAccountId, ct)));

    public Task PublishMarketWindowUpdatedAsync(object? market, CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishMarketWindowUpdatedAsync(market, ct)));

    public Task PublishCandleClosedAsync(long candleTime, CancellationToken ct = default) =>
        Task.WhenAll(_publishers.Select(p => p.PublishCandleClosedAsync(candleTime, ct)));
}
