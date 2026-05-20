using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Api.Services;

public static class TradeFeedBuilder
{
    public static async Task<IReadOnlyList<object>> BuildAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        TradingMode modeFilter,
        int contextId,
        int limit,
        MarketEntity? liveMarket,
        MarketEntity? nextScheduledMarket,
        CancellationToken ct)
    {
        var trades = await db.Trades
            .AsNoTracking()
            .Include(t => t.Market)
            .Where(t => t.Mode == modeFilter && t.PaperAccountId == contextId)
            .OrderByDescending(t => t.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);

        var openTrades = await db.Trades
            .AsNoTracking()
            .Include(t => t.Market)
            .Where(t =>
                t.Won == null
                && t.Mode == modeFilter
                && t.PaperAccountId == contextId)
            .ToListAsync(ct);

        var skips = await db.SkippedBets
            .AsNoTracking()
            .Include(s => s.Market)
            .Where(s => s.Mode == modeFilter && s.PaperAccountId == contextId)
            .OrderByDescending(s => s.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);

        var groups = new Dictionary<string, FeedGroupBuilder>(StringComparer.OrdinalIgnoreCase);
        var liveStartMs = ToMs(liveMarket?.WindowStartUtc);
        var nextStartMs = ToMs(nextScheduledMarket?.WindowStartUtc);

        FeedGroupBuilder GetOrCreate(long windowStartMs, MarketEntity market)
        {
            var key = WindowGroupKey(windowStartMs);
            if (!groups.TryGetValue(key, out var group))
            {
                group = new FeedGroupBuilder(NormalizeMarketWindow(market, windowStartMs));
                groups[key] = group;
            }
            else
            {
                group.RefreshMarket(NormalizeMarketWindow(market, windowStartMs));
            }

            return group;
        }

        foreach (var trade in trades)
        {
            if (trade.Market == null) continue;
            var windowStartMs = trade.CandleTime * 1000L;
            var market = PickMarketForCandle(trade.CandleTime, trade.Market, liveMarket, nextScheduledMarket);
            GetOrCreate(windowStartMs, market).Fills.Add(ToTradeFill(trade, settings.CommissionPercent));
        }

        foreach (var skip in skips)
        {
            if (skip.Market == null) continue;
            var windowStartMs = skip.CandleTime * 1000L;
            var market = PickMarketForCandle(skip.CandleTime, skip.Market, liveMarket, nextScheduledMarket);
            GetOrCreate(windowStartMs, market).Fills.Add(ToSkipFill(skip));
        }

        if (liveStartMs is > 0 && liveMarket != null)
        {
            var liveGroup = GetOrCreate(liveStartMs.Value, liveMarket);
            liveGroup.IsPrimary = true;
            AttachOpenTradesToLiveWindow(liveGroup, openTrades, settings.CommissionPercent);
            EnsureEngineStoppedFillForInProgressWindow(liveGroup, settings);
        }

        if (nextStartMs is > 0 && nextScheduledMarket != null && nextStartMs != liveStartMs)
        {
            var nextGroup = GetOrCreate(nextStartMs.Value, nextScheduledMarket);
            nextGroup.IsUpcoming = true;
        }

        return groups.Values
            .OrderBy(g => DisplayRank(g, nextStartMs, liveStartMs))
            .ThenByDescending(g => g.WindowStartMs)
            .Select(g => g.ToDto())
            .ToList();
    }

    private static int DisplayRank(FeedGroupBuilder g, long? nextStartMs, long? liveStartMs)
    {
        if (g.IsUpcoming || (nextStartMs is > 0 && g.WindowStartMs == nextStartMs))
        {
            return 0;
        }

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (g.WindowEndMs > g.WindowStartMs && g.WindowStartMs > nowMs)
        {
            return 0;
        }

        if (liveStartMs is > 0 && g.WindowStartMs == liveStartMs)
        {
            return 1;
        }

        var completed = g.WindowEndMs > g.WindowStartMs && nowMs >= g.WindowEndMs;
        return completed ? 3 : 2;
    }

    /// <summary>
    /// Copy open fills onto the live primary card when they belong to this window but were
    /// grouped under a different key (candle vs Gamma window start mismatch).
    /// </summary>
    private static void AttachOpenTradesToLiveWindow(
        FeedGroupBuilder liveGroup,
        IReadOnlyList<TradeEntity> openTrades,
        double commissionPercent)
    {
        if (HasActualBet(liveGroup))
        {
            return;
        }

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (nowMs < liveGroup.WindowStartMs || nowMs >= liveGroup.WindowEndMs)
        {
            return;
        }

        foreach (var trade in openTrades)
        {
            if (!TradeBelongsToLiveWindow(trade, liveGroup))
            {
                continue;
            }

            var fill = ToTradeFill(trade, commissionPercent);
            if (liveGroup.Fills.Any(f => f.Id == fill.Id))
            {
                continue;
            }

            liveGroup.Fills.Add(fill);
        }
    }

    private static bool TradeBelongsToLiveWindow(TradeEntity trade, FeedGroupBuilder liveGroup)
    {
        var tradeStartMs = trade.CandleTime * 1000L;
        if (tradeStartMs >= liveGroup.WindowStartMs && tradeStartMs < liveGroup.WindowEndMs)
        {
            return true;
        }

        var marketStartMs = ToMs(trade.Market?.WindowStartUtc);
        if (marketStartMs == liveGroup.WindowStartMs)
        {
            return true;
        }

        return trade.Market != null
            && string.Equals(
                trade.Market.ConditionId,
                liveGroup.Market.ConditionId,
                StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// In-progress window with engine off (reset, stop, or startup) and no bet — show as engine stopped.
    /// </summary>
    private static void EnsureEngineStoppedFillForInProgressWindow(
        FeedGroupBuilder group,
        EngineSettingsEntity settings)
    {
        if (settings.IsRunning)
        {
            return;
        }

        if (HasActualBet(group))
        {
            return;
        }

        if (group.Fills.Any(f => f.Result == "Skipped"))
        {
            return;
        }

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (nowMs < group.WindowStartMs || nowMs >= group.WindowEndMs)
        {
            return;
        }

        group.Fills.Add(new FeedFill
        {
            Id = $"engine-stopped-{group.Market.ConditionId}",
            TimeMs = group.WindowStartMs,
            Result = "Skipped",
            SkipReason = "engine_stopped",
        });
    }

    private static MarketEntity PickMarketForCandle(
        long candleTimeSec,
        MarketEntity linked,
        MarketEntity? liveMarket,
        MarketEntity? nextScheduledMarket)
    {
        var candleStartMs = candleTimeSec * 1000L;
        if (ToMs(linked.WindowStartUtc) == candleStartMs) return linked;
        if (liveMarket != null && ToMs(liveMarket.WindowStartUtc) == candleStartMs) return liveMarket;
        if (nextScheduledMarket != null && ToMs(nextScheduledMarket.WindowStartUtc) == candleStartMs)
        {
            return nextScheduledMarket;
        }

        return NormalizeMarketWindow(linked, candleStartMs);
    }

    private static MarketEntity NormalizeMarketWindow(MarketEntity source, long windowStartMs)
    {
        var startUtc = DateTimeOffset.FromUnixTimeMilliseconds(windowStartMs).UtcDateTime;
        return new MarketEntity
        {
            Id = source.Id,
            ConditionId = source.ConditionId,
            Slug = source.Slug,
            Title = source.Title,
            ImageUrl = source.ImageUrl,
            YesTokenId = source.YesTokenId,
            NoTokenId = source.NoTokenId,
            WindowStartUtc = startUtc,
            WindowEndUtc = source.WindowEndUtc ?? startUtc.AddMinutes(5),
            IsActive = source.IsActive,
            UpdatedAt = source.UpdatedAt,
        };
    }

    private static bool HasActualBet(FeedGroupBuilder group) =>
        group.Fills.Any(f => f.Result is "Open" or "Won" or "Lost");

    private static string WindowGroupKey(long windowStartMs) => $"window:{windowStartMs}";

    private static FeedFill ToTradeFill(TradeEntity t, double commissionPercent)
    {
        var result = t.Won switch
        {
            null => "Open",
            true => "Won",
            false => "Lost",
        };

        var pnlUsd = t.PnlUsd;
        if (pnlUsd == null && t.Won is bool won && t.StakeUsd > 0)
        {
            pnlUsd = TrendBetStrategySimulator.ComputeBetPnl(
                won,
                t.StakeUsd,
                commissionPercent,
                t.EntryPrice).Pnl;
        }

        return new FeedFill
        {
            Id = $"trade-{t.Id}",
            TimeMs = t.CandleTime * 1000L,
            Side = t.Side.ToString(),
            StakeUsd = t.StakeUsd,
            EntryPrice = t.EntryPrice,
            EntryShares = TrendBetStrategySimulator.ComputeEntryShares(t.StakeUsd, t.EntryPrice),
            Mode = t.Mode.ToString(),
            Result = result,
            Won = t.Won,
            PnlUsd = pnlUsd,
            PolymarketOrderId = t.PolymarketOrderId,
        };
    }

    private static FeedFill ToSkipFill(SkippedBetEntity s) => new()
    {
        Id = $"skip-{s.Id}",
        TimeMs = s.CandleTime * 1000L,
        Result = "Skipped",
        SkipReason = s.SkipReason,
    };

    private static long? ToMs(DateTime? dt) =>
        dt == null ? null : new DateTimeOffset(DateTime.SpecifyKind(dt.Value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    private sealed class FeedGroupBuilder
    {
        public MarketEntity Market { get; private set; }
        public List<FeedFill> Fills { get; }
        public bool IsPrimary { get; set; }
        public bool IsUpcoming { get; set; }
        public long WindowStartMs { get; }
        public long WindowEndMs { get; }

        public FeedGroupBuilder(
            MarketEntity market,
            List<FeedFill>? fills = null,
            bool isPrimary = false,
            bool isUpcoming = false)
        {
            Market = market;
            Fills = fills ?? [];
            IsPrimary = isPrimary;
            IsUpcoming = isUpcoming;
            WindowStartMs = ToMs(market.WindowStartUtc) ?? 0L;
            WindowEndMs = ToMs(market.WindowEndUtc) ?? WindowStartMs;
        }

        public void RefreshMarket(MarketEntity live)
        {
            Market = new MarketEntity
            {
                Id = Market.Id,
                ConditionId = live.ConditionId,
                Slug = live.Slug ?? Market.Slug,
                Title = live.Title ?? Market.Title,
                ImageUrl = live.ImageUrl ?? Market.ImageUrl,
                YesTokenId = live.YesTokenId,
                NoTokenId = live.NoTokenId,
                WindowStartUtc = live.WindowStartUtc ?? Market.WindowStartUtc,
                WindowEndUtc = live.WindowEndUtc ?? Market.WindowEndUtc,
                IsActive = live.IsActive,
                UpdatedAt = live.UpdatedAt,
            };
        }

        public object ToDto()
        {
            var startMs = WindowStartMs;
            var endMs = WindowEndMs > startMs ? WindowEndMs : startMs;
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var completed = endMs > startMs && nowMs >= endMs;
            var windowStarted = startMs > 0 && nowMs >= startMs && !completed;
            var scheduled = !completed && startMs > nowMs;

            Fills.Sort((a, b) => a.TimeMs.CompareTo(b.TimeMs));

            return new
            {
                key = WindowGroupKey(startMs),
                marketTitle = Market.Title ?? "BTC Up or Down — 5 min",
                marketSlug = Market.Slug,
                marketImageUrl = Market.ImageUrl,
                windowStartMs = startMs,
                windowEndMs = endMs,
                completed,
                windowStarted,
                scheduled,
                isPrimary = IsPrimary,
                isUpcoming = IsUpcoming,
                isLive = Market.IsActive && !completed,
                fills = Fills.Select(f => new
                {
                    f.Id,
                    timeMs = f.TimeMs,
                    f.Side,
                    f.StakeUsd,
                    f.EntryPrice,
                    entryShares = f.EntryShares,
                    f.Mode,
                    f.Result,
                    f.SkipReason,
                    f.Won,
                    f.PnlUsd,
                    f.PolymarketOrderId,
                }),
            };
        }
    }

    private sealed class FeedFill
    {
        public required string Id { get; init; }
        public long TimeMs { get; init; }
        public string? Side { get; init; }
        public double? StakeUsd { get; init; }
        public double? EntryPrice { get; init; }
        public double? EntryShares { get; init; }
        public string? Mode { get; init; }
        public required string Result { get; init; }
        public string? SkipReason { get; init; }
        public bool? Won { get; init; }
        public double? PnlUsd { get; init; }
        public string? PolymarketOrderId { get; init; }
    }
}
