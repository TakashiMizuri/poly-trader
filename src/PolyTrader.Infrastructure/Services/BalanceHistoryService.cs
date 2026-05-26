using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

/// <summary>Ideal Polymarket 1:1 entry price for the expected balance curve.</summary>
internal static class BalanceHistoryIdealEntry
{
    public const double EntryPrice = 0.5;
}

public sealed record BalanceHistoryPoint(long Time, double Value);

public sealed record TradePayoutPoint(long Time, double Ratio, bool Won, int TradeId);

public sealed record BalanceHistoryResult(
    double InitialBalance,
    IReadOnlyList<BalanceHistoryPoint> Actual,
    IReadOnlyList<BalanceHistoryPoint> Expected,
    IReadOnlyList<TradePayoutPoint> PayoutRatios);

public sealed class BalanceHistoryService(IPolymarketClobService clob)
{
    public async Task<BalanceHistoryResult> BuildAsync(
        PolyTraderDbContext db,
        TradingMode mode,
        int? paperAccountId,
        int limit = 500,
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
                return new BalanceHistoryResult(0, [], [], []);
            }

            account = await db.PaperAccounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == accountId, ct);
            if (account == null)
            {
                return new BalanceHistoryResult(0, [], [], []);
            }

            contextId = account.Id;
        }

        var initialBalance = isPaper ? account!.InitialBalance : 0;
        var snapshots = await db.BalanceSnapshots.AsNoTracking()
            .Where(b => b.PaperAccountId == contextId)
            .ToListAsync(ct);

        snapshots = snapshots
            .Select(s => (Snap: s, ChartTime: SnapshotChartTime(s)))
            .Where(x => x.ChartTime > 0)
            .OrderByDescending(x => x.ChartTime)
            .Take(limit)
            .OrderBy(x => x.ChartTime)
            .Select(x => x.Snap)
            .ToList();

        var actual = BuildActualSeries(snapshots, account, isPaper);
        if (!isPaper)
        {
            await TryAppendLiveBalanceNowAsync(actual);
        }

        actual = NormalizeChartSeries(actual);

        var expected = await BuildExpectedSeriesAsync(
            db,
            account,
            isPaper,
            contextId,
            actual,
            ct);

        var payoutRatios = await BuildPayoutRatioSeriesAsync(
            db,
            mode,
            contextId,
            limit,
            ct);

        return new BalanceHistoryResult(initialBalance, actual, expected, payoutRatios);
    }

    private static async Task<IReadOnlyList<TradePayoutPoint>> BuildPayoutRatioSeriesAsync(
        PolyTraderDbContext db,
        TradingMode mode,
        int tradeContextId,
        int limit,
        CancellationToken ct)
    {
        var trades = await db.Trades.AsNoTracking()
            .Where(t => t.Mode == mode
                && t.PaperAccountId == tradeContextId
                && t.Won != null)
            .OrderByDescending(t => t.CandleTime)
            .ThenByDescending(t => t.Id)
            .Take(limit)
            .ToListAsync(ct);

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

    /// <summary>
    /// Expected equity curve: backtest-style chain on our real trades — each point is the previous
    /// expected balance plus ideal 1:1 PnL (0.5 entry, default stake % and commission).
    /// </summary>
    private static async Task<IReadOnlyList<BalanceHistoryPoint>> BuildExpectedSeriesAsync(
        PolyTraderDbContext db,
        PaperAccountEntity? account,
        bool isPaper,
        int tradeContextId,
        IReadOnlyList<BalanceHistoryPoint> actual,
        CancellationToken ct)
    {
        if (actual.Count == 0)
        {
            return [];
        }

        var mode = isPaper ? TradingMode.Paper : TradingMode.Live;
        var startSec = actual[0].Time;
        var endSec = actual[^1].Time;

        var trades = await db.Trades.AsNoTracking()
            .Where(t => t.Mode == mode
                && t.PaperAccountId == tradeContextId
                && t.CandleTime >= startSec
                && t.CandleTime <= endSec)
            .OrderBy(t => t.CandleTime)
            .ThenBy(t => t.Id)
            .ToListAsync(ct);

        var startBalance = isPaper && account != null
            ? account.InitialBalance
            : actual[0].Value;

        var strategyParams = ExpectedCurveStrategyParams(startBalance);

        var result = new List<BalanceHistoryPoint>(actual.Count);
        var expectedBalance = startBalance;
        var tradeIdx = 0;

        foreach (var point in actual)
        {
            while (tradeIdx < trades.Count && trades[tradeIdx].CandleTime <= point.Time)
            {
                expectedBalance = ApplyIdealSettlement(
                    expectedBalance,
                    trades[tradeIdx],
                    strategyParams);
                tradeIdx++;
            }

            result.Add(new BalanceHistoryPoint(point.Time, expectedBalance));
        }

        return result;
    }

    /// <summary>Default backtest stake/fee (STRATEGY.md); not live engine overrides.</summary>
    private static TrendBetStrategyParams ExpectedCurveStrategyParams(double startBalance)
    {
        var d = TrendBetStrategyParams.Default;
        return new TrendBetStrategyParams
        {
            StartBalance = startBalance,
            BetStake = d.BetStake,
            BetStakeMode = d.BetStakeMode,
            BetStakePercent = d.BetStakePercent,
            CommissionPercent = d.CommissionPercent,
            MaxBetStakeUsd = d.MaxBetStakeUsd,
            BlendFade2 = d.BlendFade2,
        };
    }

    /// <summary>Advance expected balance after one settled trade (stake from balance before bet).</summary>
    private static double ApplyIdealSettlement(
        double expectedBalance,
        TradeEntity trade,
        TrendBetStrategyParams parameters)
    {
        if (trade.Won is not bool won)
        {
            return expectedBalance;
        }

        var stake = BetStakeResolver.ResolveForBalance(expectedBalance, parameters);
        if (stake is not > 0)
        {
            return expectedBalance;
        }

        var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
            won,
            stake.Value,
            parameters.CommissionPercent,
            BalanceHistoryIdealEntry.EntryPrice);

        return SafeBetStake.ClampBalanceAfterBet(expectedBalance + pnl);
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
