using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Api.Services;

public static class ExecutionGapAnalyticsService
{
    private const int WarmupBars = 72;
    private const double CounterfactualEntryPrice = 0.50;

    private static readonly HashSet<string> ExecutionSkipReasons = new(StringComparer.OrdinalIgnoreCase)
    {
        "entry_price_out_of_range",
        "order_failed",
        "balance_unavailable",
        "clob_min_order_size",
        "insufficient_balance",
    };

    public static async Task<object> BuildAsync(
        PolyTraderDbContext db,
        TradingMode modeFilter,
        int contextId,
        string? period,
        CancellationToken ct)
    {
        var periodStart = TradeStatisticsService.ResolvePeriodStartCandleTime(period);
        var nowCandleTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var settings = await db.EngineSettings.AsNoTracking().FirstAsync(ct);

        var tradesQuery = db.Trades
            .AsNoTracking()
            .Where(t => t.Mode == modeFilter && t.PaperAccountId == contextId);
        var skipsQuery = db.SkippedBets
            .AsNoTracking()
            .Where(s => s.Mode == modeFilter && s.PaperAccountId == contextId);

        if (periodStart is long from)
        {
            tradesQuery = tradesQuery.Where(t => t.CandleTime >= from);
            skipsQuery = skipsQuery.Where(s => s.CandleTime >= from);
        }

        var trades = await tradesQuery.OrderBy(t => t.CandleTime).ToListAsync(ct);
        var skips = await skipsQuery.ToListAsync(ct);

        var skipByTime = skips
            .GroupBy(s => s.CandleTime)
            .ToDictionary(g => g.Key, g => g.First());

        var tradeByTime = trades.ToDictionary(t => t.CandleTime);

        var candleFrom = periodStart is long ps
            ? ps - WarmupBars * 300L
            : (trades.Count > 0 || skips.Count > 0
                ? Math.Min(
                    trades.Count > 0 ? trades.Min(t => t.CandleTime) : long.MaxValue,
                    skips.Count > 0 ? skips.Min(s => s.CandleTime) : long.MaxValue) - WarmupBars * 300L
                : nowCandleTime - 7 * 86_400L);

        var candleRows = await db.CandleSnapshots.AsNoTracking()
            .Where(c => c.Time >= candleFrom && c.Time <= nowCandleTime)
            .OrderBy(c => c.Time)
            .ToListAsync(ct);

        var candles = candleRows
            .Select(c => new ChartCandle
            {
                Time = c.Time,
                Open = c.Open,
                High = c.High,
                Low = c.Low,
                Close = c.Close,
            })
            .ToList();

        var signals = BlendFade2Signals.Generate(candles);
        var timeToIndex = candles
            .Select((c, i) => (c.Time, i))
            .ToDictionary(x => x.Time, x => x.i);

        var signalBars = 0;
        var tradedSignalBars = 0;
        var executionSkipSignalBars = 0;

        if (periodStart is long periodFrom)
        {
            for (var i = 0; i < candles.Count; i++)
            {
                if (!signals.EntryBar[i])
                {
                    continue;
                }

                var time = candles[i].Time;
                if (time < periodFrom || time > nowCandleTime)
                {
                    continue;
                }

                signalBars++;
                if (tradeByTime.ContainsKey(time))
                {
                    tradedSignalBars++;
                }
                else if (skipByTime.TryGetValue(time, out var skip)
                         && IsExecutionSkip(skip))
                {
                    executionSkipSignalBars++;
                }
            }
        }

        var coveragePct = signalBars > 0
            ? (double)tradedSignalBars / signalBars * 100
            : (double?)null;

        var skipBreakdown = skips
            .GroupBy(s => s.SkipReason, StringComparer.OrdinalIgnoreCase)
            .Select(g => new
            {
                reason = g.Key,
                count = g.Count(),
                isExecution = ExecutionSkipReasons.Contains(g.Key),
            })
            .OrderByDescending(g => g.count)
            .ThenBy(g => g.reason, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var startBalance = InferStartBalance(trades, settings);
        var counterfactualPnlUsd = SimulateCounterfactualPnl(
            candles,
            signals,
            skipByTime,
            tradeByTime,
            settings,
            startBalance,
            periodStart,
            nowCandleTime);

        var entryEdgeUsd = trades
            .Where(t => t.Won == true && t.StakeUsd > 0)
            .Sum(t =>
            {
                var pnlAtHalf = TrendBetStrategySimulator.ComputeBetPnl(
                    true,
                    t.StakeUsd,
                    0,
                    CounterfactualEntryPrice).Pnl;
                return (t.PnlUsd ?? 0) - pnlAtHalf;
            });

        return new
        {
            period = string.IsNullOrWhiteSpace(period) ? "all" : period.Trim().ToLowerInvariant(),
            fromCandleTime = periodStart,
            toCandleTime = nowCandleTime,
            mode = modeFilter.ToString(),
            paperAccountId = modeFilter == TradingMode.Paper ? contextId : 0,
            signalBars,
            tradedBars = tradedSignalBars,
            executionSkipSignalBars,
            coveragePct,
            skipBreakdown,
            counterfactualPnlUsd,
            entryEdgeUsd,
            startBalanceUsd = startBalance,
            reportCommand = "python scripts/backtest_vs_prod_dashboard.py",
        };
    }

    private static bool IsExecutionSkip(SkippedBetEntity skip) =>
        ExecutionSkipReasons.Contains(skip.SkipReason)
        && skip.SignalPresent != false;

    private static double InferStartBalance(
        IReadOnlyList<TradeEntity> trades,
        EngineSettingsEntity settings)
    {
        if (trades.Count == 0)
        {
            return 100;
        }

        var snapIdx = -1;
        for (var i = 0; i < trades.Count; i++)
        {
            if (trades[i].StakeBalanceUsd is > 0)
            {
                snapIdx = i;
                break;
            }
        }

        if (snapIdx >= 0)
        {
            var balance = trades[snapIdx].StakeBalanceUsd!.Value;
            for (var i = snapIdx - 1; i >= 0; i--)
            {
                balance -= trades[i].PnlUsd ?? 0;
            }

            return balance;
        }

        var first = trades[0];
        var pct = first.BetStakePercent ?? settings.BetStakePercent;
        if (pct > 0 && first.StakeUsd > 0)
        {
            return first.StakeUsd / (pct / 100);
        }

        return 100;
    }

    private static double SimulateCounterfactualPnl(
        IReadOnlyList<ChartCandle> candles,
        BlendFade2SignalArrays signals,
        IReadOnlyDictionary<long, SkippedBetEntity> skipByTime,
        IReadOnlyDictionary<long, TradeEntity> tradeByTime,
        EngineSettingsEntity settings,
        double startBalance,
        long? periodStart,
        long periodEnd)
    {
        if (periodStart is not long from || candles.Count == 0)
        {
            return 0;
        }

        var balance = startBalance;
        var totalPnl = 0d;
        var stakeParams = ToStakeParams(settings, balance);

        for (var i = 0; i < candles.Count; i++)
        {
            if (!signals.EntryBar[i])
            {
                continue;
            }

            var time = candles[i].Time;
            if (time < from || time > periodEnd)
            {
                continue;
            }

            if (tradeByTime.ContainsKey(time))
            {
                continue;
            }

            if (!skipByTime.TryGetValue(time, out var skip) || !IsExecutionSkip(skip))
            {
                continue;
            }

            var trend = signals.Side[i];
            if (trend is null)
            {
                continue;
            }

            var stake = BetStakeResolver.ResolveForBalance(balance, stakeParams);
            if (stake is not > 0)
            {
                continue;
            }

            var won = TrendBetStrategySimulator.IsBetWon(trend.Value, candles[i]);
            var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
                won,
                stake.Value,
                0,
                CounterfactualEntryPrice);
            balance = SafeBetStake.ClampBalanceAfterBet(balance + pnl);
            totalPnl += pnl;
            stakeParams = ToStakeParams(settings, balance);
        }

        return totalPnl;
    }

    private static TrendBetStrategyParams ToStakeParams(EngineSettingsEntity settings, double balance) =>
        TrendBetStrategyParams.ForLiveEngine(
            balance,
            settings.BetStakeMode,
            settings.BetStakeUsd,
            settings.BetStakePercent,
            settings.MaxBetStakeUsd,
            0);
}
