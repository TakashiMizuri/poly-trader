using System.Collections.Concurrent;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class PolymarketOrderFillNotifier : IPolymarketOrderFillNotifier
{
    private readonly ConcurrentDictionary<string, FillWaiter> _waiters = new(StringComparer.OrdinalIgnoreCase);

    public void NotifyOrderUpdate(string orderId, double sizeMatched)
    {
        if (string.IsNullOrWhiteSpace(orderId) || sizeMatched <= 0)
        {
            return;
        }

        if (_waiters.TryGetValue(orderId, out var waiter))
        {
            waiter.TrySet(sizeMatched);
        }
    }

    public async Task<(double MatchedShares, bool Completed)> WaitForOrderFillAsync(
        string orderId,
        double minMatchedShares,
        TimeSpan timeout,
        CancellationToken ct = default)
    {
        var waiter = _waiters.GetOrAdd(orderId, _ => new FillWaiter());
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        try
        {
            var matched = await waiter.WaitAsync(minMatchedShares, timeoutCts.Token);
            return (matched, matched >= minMatchedShares * 0.999);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return (waiter.LastMatched, waiter.LastMatched >= minMatchedShares * 0.999);
        }
        finally
        {
            _waiters.TryRemove(orderId, out _);
        }
    }

    private sealed class FillWaiter
    {
        private readonly TaskCompletionSource<double> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private double _lastMatched;

        public double LastMatched => _lastMatched;

        public void TrySet(double matched)
        {
            _lastMatched = Math.Max(_lastMatched, matched);
            _tcs.TrySetResult(_lastMatched);
        }

        public async Task<double> WaitAsync(double minMatched, CancellationToken ct)
        {
            if (_lastMatched >= minMatched)
            {
                return _lastMatched;
            }

            using var reg = ct.Register(() => _tcs.TrySetCanceled(ct));
            var matched = await _tcs.Task.ConfigureAwait(false);
            return matched;
        }
    }
}
