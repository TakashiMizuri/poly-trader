using PolyTrader.Core.Models;

namespace PolyTrader.Infrastructure.Services;

public sealed record EntryWaitState(
    long CandleTime,
    TradingMode Mode,
    int PaperAccountId,
    int MarketId,
    string Side,
    string Trend,
    long WindowStartMs,
    DateTime StartedUtc,
    DateTime ExpiresUtc);

public interface IEntryWaitTracker
{
    void SetWaiting(EntryWaitState state);

    void Clear(long candleTime, TradingMode mode, int paperAccountId);

    IReadOnlyList<EntryWaitState> GetActive(TradingMode mode, int paperAccountId);
}

public sealed class EntryWaitTracker : IEntryWaitTracker
{
    private readonly object _lock = new();
    private readonly List<EntryWaitState> _active = [];

    public void SetWaiting(EntryWaitState state)
    {
        lock (_lock)
        {
            _active.RemoveAll(s =>
                s.CandleTime == state.CandleTime
                && s.Mode == state.Mode
                && s.PaperAccountId == state.PaperAccountId);
            _active.Add(state);
        }
    }

    public void Clear(long candleTime, TradingMode mode, int paperAccountId)
    {
        lock (_lock)
        {
            _active.RemoveAll(s =>
                s.CandleTime == candleTime
                && s.Mode == mode
                && s.PaperAccountId == paperAccountId);
        }
    }

    public IReadOnlyList<EntryWaitState> GetActive(TradingMode mode, int paperAccountId) =>
        Snapshot().Where(s => s.Mode == mode && s.PaperAccountId == paperAccountId).ToList();

    private List<EntryWaitState> Snapshot()
    {
        lock (_lock)
        {
            return [.. _active];
        }
    }
}
