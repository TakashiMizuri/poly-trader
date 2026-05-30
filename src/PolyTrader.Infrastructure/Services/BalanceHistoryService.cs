using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed record BalanceHistoryPoint(long Time, double Value);

public sealed record TradePayoutPoint(long Time, double Ratio, bool Won, int TradeId);

public sealed record BalanceHistoryResult(
    double InitialBalance,
    IReadOnlyList<BalanceHistoryPoint> Actual,
    IReadOnlyList<TradePayoutPoint> PayoutRatios);

public sealed class BalanceHistoryService(IPolymarketClobService clob)
{
    public async Task<BalanceHistoryResult> BuildAsync(
        PolyTraderDbContext db,
        TradingMode mode,
        int? paperAccountId,
        int? limit = null,
        CancellationToken ct = default)
    {
        var settings = await db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var isPaper = mode == TradingMode.Paper;

        PaperAccountEntity? account = null;
        var contextId = 0;
        if (isPaper)
        {
            var id = paperAccountId ?? settings.ActivePaperAccountId;
            if (id is not int accountId)
            {
                return new BalanceHistoryResult(0, [], []);
            }

            account = await db.PaperAccounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == accountId, ct);
            if (account == null)
            {
                return new BalanceHistoryResult(0, [], []);
            }

            contextId = account.Id;
        }

        var initialBalance = isPaper ? account!.InitialBalance : 0;
        var snapshots = await db.BalanceSnapshots.AsNoTracking()
            .Where(b => b.PaperAccountId == contextId)
            .ToListAsync(ct);

        IEnumerable<(BalanceSnapshotEntity Snap, long ChartTime)> orderedSnapshots = snapshots
            .Select(s => (Snap: s, ChartTime: SnapshotChartTime(s)))
            .Where(x => x.ChartTime > 0)
            .OrderByDescending(x => x.ChartTime);

        if (limit is > 0)
        {
            orderedSnapshots = orderedSnapshots.Take(limit.Value);
        }

        snapshots = orderedSnapshots
            .OrderBy(x => x.ChartTime)
            .Select(x => x.Snap)
            .ToList();

        var actual = BuildActualSeries(snapshots, account, isPaper);
        if (!isPaper)
        {
            await TryAppendLiveBalanceNowAsync(actual);
        }

        actual = NormalizeChartSeries(actual);

        var payoutRatios = await BuildPayoutRatioSeriesAsync(
            db,
            mode,
            contextId,
            limit,
            ct);

        return new BalanceHistoryResult(initialBalance, actual, payoutRatios);
    }

    private static async Task<IReadOnlyList<TradePayoutPoint>> BuildPayoutRatioSeriesAsync(
        PolyTraderDbContext db,
        TradingMode mode,
        int tradeContextId,
        int? limit,
        CancellationToken ct)
    {
        IQueryable<TradeEntity> tradesQuery = db.Trades.AsNoTracking()
            .Where(t => t.Mode == mode
                && t.PaperAccountId == tradeContextId
                && t.Won != null)
            .OrderByDescending(t => t.CandleTime)
            .ThenByDescending(t => t.Id);

        if (limit is > 0)
        {
            tradesQuery = tradesQuery.Take(limit.Value);
        }

        var trades = await tradesQuery.ToListAsync(ct);

        trades.Reverse();

        var points = new List<TradePayoutPoint>(trades.Count);
        foreach (var trade in trades)
        {
            if (TradeRecording.ResolvePayoutRatio(trade) is not double ratio)
            {
                continue;
            }

            points.Add(new TradePayoutPoint(
                CandleTimeToChartTime(trade.CandleTime),
                ratio,
                trade.Won!.Value,
                trade.Id));
        }

        return points;
    }

    private static long CandleTimeToChartTime(long candleTime) =>
        candleTime >= 1_000_000_000_000L ? candleTime / 1000L : candleTime;

    /// <summary>
    /// Optional live tail point. Uses DB snapshots only when CLOB is slow/unavailable —
    /// must not block the history API on the HTTP request token or multi-second CLOB retries.
    /// </summary>
    private async Task TryAppendLiveBalanceNowAsync(List<BalanceHistoryPoint> actual)
    {
        if (!clob.IsConfigured)
        {
            return;
        }

        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1.5));
            var live = await clob.GetCollateralBalanceAsync(timeout.Token, maxAttempts: 1);
            if (live is not double balance)
            {
                return;
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (actual.Count > 0)
            {
                var last = actual[^1];
                if (now < last.Time)
                {
                    return;
                }

                if (last.Time == now)
                {
                    actual[^1] = new BalanceHistoryPoint(now, balance);
                    return;
                }

                if (Math.Abs(last.Value - balance) < 0.000_1)
                {
                    return;
                }
            }

            actual.Add(new BalanceHistoryPoint(now, balance));
        }
        catch (OperationCanceledException)
        {
            // CLOB slow or request budget exhausted — chart still has snapshot series.
        }
    }

    private static List<BalanceHistoryPoint> BuildActualSeries(
        IReadOnlyList<BalanceSnapshotEntity> snapshots,
        PaperAccountEntity? account,
        bool isPaper)
    {
        var points = new List<BalanceHistoryPoint>();
        if (isPaper && account != null)
        {
            var startTime = ToChartTime(account.CreatedAt);
            if (startTime > 0)
            {
                points.Add(new BalanceHistoryPoint(startTime, account.InitialBalance));
            }
        }

        foreach (var snap in snapshots)
        {
            var time = SnapshotChartTime(snap);
            if (time <= 0)
            {
                continue;
            }

            var value = snap.Equity ?? snap.CashBalance;
            if (points.Count > 0 && points[^1].Time == time)
            {
                points[^1] = new BalanceHistoryPoint(time, value);
            }
            else
            {
                points.Add(new BalanceHistoryPoint(time, value));
            }
        }

        return points;
    }

    /// <summary>Sort ascending by time and keep the last value per timestamp (lightweight-charts requirement).</summary>
    private static List<BalanceHistoryPoint> NormalizeChartSeries(List<BalanceHistoryPoint> points)
    {
        if (points.Count <= 1)
        {
            return points;
        }

        points.Sort((a, b) => a.Time.CompareTo(b.Time));

        var merged = new List<BalanceHistoryPoint>(points.Count);
        foreach (var point in points)
        {
            if (merged.Count > 0 && merged[^1].Time == point.Time)
            {
                merged[^1] = point;
            }
            else
            {
                merged.Add(point);
            }
        }

        return merged;
    }

    /// <summary>Normalize snapshot candle key to chart unix seconds (engine uses seconds; legacy rows may use ms).</summary>
    private static long SnapshotChartTime(BalanceSnapshotEntity snap)
    {
        if (snap.CandleTime is > 0)
        {
            var key = snap.CandleTime.Value;
            return key >= 1_000_000_000_000L ? key / 1000L : key;
        }

        return ToChartTime(snap.Timestamp);
    }

    private static long ToChartTime(DateTime utc) =>
        new DateTimeOffset(utc, TimeSpan.Zero).ToUnixTimeSeconds();
}
