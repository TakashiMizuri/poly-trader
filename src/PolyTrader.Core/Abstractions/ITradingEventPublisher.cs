using PolyTrader.Core.Models;

namespace PolyTrader.Core.Abstractions;

public interface ITradingEventPublisher
{
    Task PublishEngineStatusAsync(bool isRunning, string mode, CancellationToken ct = default);
    Task PublishTradePlacedAsync(object trade, CancellationToken ct = default);
    Task PublishEntryFailedAsync(EntryFailedEvent entryFailed, CancellationToken ct = default);
    /// <summary>Invalidate positions feed cache on the client (skips, patience, settlements).</summary>
    Task PublishPositionsFeedChangedAsync(CancellationToken ct = default);
    Task PublishBalanceUpdatedAsync(double balance, int paperAccountId = 0, CancellationToken ct = default);
    Task PublishMarketWindowUpdatedAsync(object? market, CancellationToken ct = default);
    Task PublishCandleClosedAsync(long candleTime, CancellationToken ct = default);
}
