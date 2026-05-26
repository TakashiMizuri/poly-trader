using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Services;

public static class TradeFeedBuilder
{
    private const long DefaultWindowDurationMs = 5 * 60 * 1000L;

    private static readonly HashSet<string> EntryErrorSkipReasons = new(StringComparer.OrdinalIgnoreCase)
    {
        "order_failed",
        "insufficient_balance",
        "balance_unavailable",
        "no_market",
        "clob_min_order_size",
    };

    public static async Task<IReadOnlyList<object>> BuildAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        TradingMode modeFilter,
        int contextId,
        int limit,
        MarketEntity? liveMarket,
        MarketEntity? nextScheduledMarket,
        IEntryWaitTracker? entryWaitTracker = null,
        CancellationToken ct = default)
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
            AttachTradesToLiveWindow(liveGroup, trades, openTrades, settings.CommissionPercent);
            AttachSkipsToLiveWindow(liveGroup, skips);
            AttachEntryWaitsToLiveWindow(liveGroup, entryWaitTracker, modeFilter, contextId);
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

        var endMs = g.WindowEndMs > g.WindowStartMs
            ? g.WindowEndMs
            : g.WindowStartMs + DefaultWindowDurationMs;
        var completed = endMs > g.WindowStartMs && nowMs >= endMs;
        return completed ? 3 : 2;
    }

    /// <summary>
    /// Copy fills onto the live primary card when they belong to this window but were
    /// grouped under a different key (candle vs Gamma window start mismatch).
    /// </summary>
    private static void AttachTradesToLiveWindow(
        FeedGroupBuilder liveGroup,
        IReadOnlyList<TradeEntity> recentTrades,
        IReadOnlyList<TradeEntity> openTrades,
        double commissionPercent)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var existing in liveGroup.Fills)
        {
            seen.Add(existing.Id);
        }

        foreach (var trade in recentTrades.Concat(openTrades))
        {
            if (!TradeBelongsToLiveWindow(trade, liveGroup))
            {
                continue;
            }

            var fill = ToTradeFill(trade, commissionPercent);
            if (!seen.Add(fill.Id))
            {
                continue;
            }

            liveGroup.Fills.Add(fill);
        }

        if (HasActualBet(liveGroup))
        {
            liveGroup.Fills.RemoveAll(f =>
                f.Result == "Skipped" && f.SkipReason == "no_signal");
        }
    }

    /// <summary>
    /// Copy skip fills onto the live primary card when candle time and Gamma window diverge.
    /// </summary>
    private static void AttachSkipsToLiveWindow(
        FeedGroupBuilder liveGroup,
        IReadOnlyList<SkippedBetEntity> skips)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var existing in liveGroup.Fills)
        {
            seen.Add(existing.Id);
        }

        foreach (var skip in skips)
        {
            if (skip.Market == null || !SkipBelongsToLiveWindow(skip, liveGroup))
            {
                continue;
            }

            var fill = ToSkipFill(skip);
            if (!seen.Add(fill.Id))
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

    private static bool SkipBelongsToLiveWindow(SkippedBetEntity skip, FeedGroupBuilder liveGroup)
    {
        var skipStartMs = skip.CandleTime * 1000L;
        if (skipStartMs >= liveGroup.WindowStartMs && skipStartMs < liveGroup.WindowEndMs)
        {
            return true;
        }

        var marketStartMs = ToMs(skip.Market?.WindowStartUtc);
        if (marketStartMs == liveGroup.WindowStartMs)
        {
            return true;
        }

        return skip.Market != null
            && string.Equals(
                skip.Market.ConditionId,
                liveGroup.Market.ConditionId,
                StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// In-progress window with engine off (reset, stop, or startup) and no bet — show as engine stopped.
    /// </summary>
    private static void AttachEntryWaitsToLiveWindow(
        FeedGroupBuilder liveGroup,
        IEntryWaitTracker? entryWaitTracker,
        TradingMode modeFilter,
        int contextId)
    {
        if (entryWaitTracker == null)
        {
            return;
        }

        if (HasActualBet(liveGroup))
        {
            return;
        }

        if (liveGroup.Fills.Any(f => f.Result is "Open" or "Pending"))
        {
            return;
        }

        foreach (var wait in entryWaitTracker.GetActive(modeFilter, contextId))
        {
            if (wait.WindowStartMs != liveGroup.WindowStartMs
                && wait.CandleTime * 1000L != liveGroup.WindowStartMs)
            {
                continue;
            }

            var startedMs = new DateTimeOffset(
                DateTime.SpecifyKind(wait.StartedUtc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
            var waitMs = (long)EntryPriceRules.PatienceWaitDuration.TotalMilliseconds;
            liveGroup.Fills.Add(new FeedFill
            {
                Id = $"entry-wait-{wait.CandleTime}-{wait.Mode}-{wait.PaperAccountId}",
                TimeMs = wait.WindowStartMs > 0 ? wait.WindowStartMs : wait.CandleTime * 1000L,
                Side = wait.Side,
                Result = "Pending",
                SkipReason = "waiting_for_entry",
                EntryWaitStartedMs = startedMs,
                EntryWaitExpiresMs = startedMs + waitMs,
            });
            break;
        }
    }

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
        var endUtc = source.WindowEndUtc;
        if (endUtc == null || endUtc.Value <= startUtc)
        {
            endUtc = startUtc.AddMinutes(5);
        }
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
            WindowEndUtc = endUtc,
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

        var awaitingRedeem = t.Mode == TradingMode.Live
            && t.Won == true
            && t.RedeemedAt == null;

        return new FeedFill
        {
            Id = $"trade-{t.Id}",
            TimeMs = t.CandleTime * 1000L,
            Side = t.Side.ToString(),
            StakeUsd = t.StakeUsd,
            RequestedStakeUsd = t.RequestedStakeUsd,
            EntryPrice = t.EntryPrice,
            EntryShares = TrendBetStrategySimulator.ComputeEntryShares(t.StakeUsd, t.EntryPrice),
            Mode = t.Mode.ToString(),
            Result = result,
            Won = t.Won,
            PnlUsd = pnlUsd,
            PolymarketOrderId = t.PolymarketOrderId,
            AwaitingRedeem = awaitingRedeem,
            EntryWaves = TradeEntryWavesJson.Deserialize(t.EntryWavesJson),
        };
    }

    private static FeedFill ToSkipFill(SkippedBetEntity s) => new()
    {
        Id = $"skip-{s.Id}",
        TimeMs = s.CandleTime * 1000L,
        Result = EntryErrorSkipReasons.Contains(s.SkipReason) ? "Error" : "Skipped",
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
            var endMs = WindowEndMs > startMs
                ? WindowEndMs
                : (startMs > 0 ? startMs + DefaultWindowDurationMs : startMs);
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
                    f.RequestedStakeUsd,
                    isPartialFill = f.RequestedStakeUsd is > 0
                        && f.RequestedStakeUsd > f.StakeUsd + 0.01,
                    f.EntryPrice,
                    entryShares = f.EntryShares,
                    f.Mode,
                    f.Result,
                    f.SkipReason,
                    f.Won,
                    f.PnlUsd,
                    f.PolymarketOrderId,
                    awaitingRedeem = f.AwaitingRedeem,
                    entryWaitStartedMs = f.EntryWaitStartedMs,
                    entryWaitExpiresMs = f.EntryWaitExpiresMs,
                    entryWaves = f.EntryWaves?.Select(w => new
                    {
                        wave = w.Wave,
                        label = w.Label,
                        requestedUsd = w.RequestedUsd,
                        filledUsd = w.FilledUsd,
                        fillPercent = w.FillPercent,
                        entryPrice = w.EntryPrice,
                        orderId = w.OrderId,
                    }),
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
        public double? RequestedStakeUsd { get; init; }
        public double? EntryPrice { get; init; }
        public double? EntryShares { get; init; }
        public string? Mode { get; init; }
        public required string Result { get; init; }
        public string? SkipReason { get; init; }
        public bool? Won { get; init; }
        public double? PnlUsd { get; init; }
        public string? PolymarketOrderId { get; init; }
        public bool AwaitingRedeem { get; init; }
        public long? EntryWaitStartedMs { get; init; }
        public long? EntryWaitExpiresMs { get; init; }
        public IReadOnlyList<TradeEntryWaveDto>? EntryWaves { get; init; }
    }
}
