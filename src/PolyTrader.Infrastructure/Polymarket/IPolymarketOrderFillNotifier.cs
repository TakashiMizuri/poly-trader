namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Fast fill notifications from Polymarket user WebSocket (falls back to REST polling).</summary>
public interface IPolymarketOrderFillNotifier
{
    void NotifyOrderUpdate(string orderId, double sizeMatched);

    /// <summary>Wait until order has at least <paramref name="minMatchedShares"/> or timeout.</summary>
    Task<(double MatchedShares, bool Completed)> WaitForOrderFillAsync(
        string orderId,
        double minMatchedShares,
        TimeSpan timeout,
        CancellationToken ct = default);
}
