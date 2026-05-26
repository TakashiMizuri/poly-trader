using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;

namespace PolyTrader.Api.Services;

public static class TradeStatisticsService
{
    private static readonly HashSet<string> EntryErrorSkipReasons = new(StringComparer.OrdinalIgnoreCase)
    {
        "order_failed",
        "insufficient_balance",
        "balance_unavailable",
        "no_market",
        "clob_min_order_size",
    };

    public static long? ResolvePeriodStartCandleTime(string? period)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return period?.Trim().ToLowerInvariant() switch
        {
            "day" or "24h" => now - 86_400,
            "week" or "7d" => now - 7 * 86_400,
            "month" or "30d" => now - 30 * 86_400,
            "90d" or "quarter" => now - 90 * 86_400,
            _ => null,
        };
    }

    public static async Task<object> BuildAsync(
        PolyTraderDbContext db,
        TradingMode modeFilter,
        int contextId,
        string? period,
        CancellationToken ct)
    {
        var periodStart = ResolvePeriodStartCandleTime(period);
        var nowCandleTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

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

        var trades = await tradesQuery.ToListAsync(ct);
        var skips = await skipsQuery.ToListAsync(ct);

        var won = trades.Count(t => t.Won == true);
        var lost = trades.Count(t => t.Won == false);
        var open = trades.Count(t => t.Won == null);
        var settled = won + lost;
        var totalPnlUsd = trades
            .Where(t => t.PnlUsd is double pnl)
            .Sum(t => t.PnlUsd!.Value);

        var winPayoutRatios = trades
            .Where(t => t.Won == true && t.PnlUsd is double && t.StakeUsd > 0)
            .Select(t => TrendBetStrategySimulator.ComputePayoutRatio(t.PnlUsd!.Value, t.StakeUsd))
            .ToList();
        double? avgWinPayoutRatio = winPayoutRatios.Count > 0
            ? winPayoutRatios.Average()
            : null;

        var skipGroups = skips
            .GroupBy(s => s.SkipReason, StringComparer.OrdinalIgnoreCase)
            .Select(g => new
            {
                reason = g.Key,
                count = g.Count(),
                category = EntryErrorSkipReasons.Contains(g.Key) ? "Error" : "Skipped",
            })
            .OrderByDescending(g => g.count)
            .ThenBy(g => g.reason, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var skippedCount = skipGroups
            .Where(g => g.category == "Skipped")
            .Sum(g => g.count);
        var errorCount = skipGroups
            .Where(g => g.category == "Error")
            .Sum(g => g.count);
        var totalEvents = trades.Count + skips.Count;

        return new
        {
            period = string.IsNullOrWhiteSpace(period) ? "all" : period.Trim().ToLowerInvariant(),
            fromCandleTime = periodStart,
            toCandleTime = nowCandleTime,
            mode = modeFilter.ToString(),
            paperAccountId = modeFilter == TradingMode.Paper ? contextId : 0,
            totalEvents,
            tradesOpened = trades.Count,
            tradesSettled = settled,
            tradesOpen = open,
            won,
            lost,
            winRate = settled > 0 ? (double)won / settled : (double?)null,
            avgWinPayoutRatio,
            totalPnlUsd,
            skippedCount,
            errorCount,
            skipBreakdown = skipGroups.Select(g => new
            {
                g.reason,
                g.count,
                g.category,
                shareOfTotal = totalEvents > 0 ? (double)g.count / totalEvents : 0d,
            }),
        };
    }
}
