using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Binance;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

/// <summary>
/// Records <c>engine_stopped</c> for the in-progress BTC 5m window when entry was missed
/// (global reset, engine stop, mid-window start, or startup recovery).
/// </summary>
public sealed class InProgressWindowSkipService(
    PolyTraderDbContext db,
    IBinanceMarketService binance,
    IPolymarketGammaService gamma,
    ILogger<InProgressWindowSkipService> logger)
{
    /// <summary>Allow a few seconds after window open before treating entry as missed.</summary>
    private const long EntryGraceMs = 5_000;

    public async Task<bool> TryRecordEngineStoppedForInProgressWindowAsync(
        EngineSettingsEntity settings,
        CancellationToken ct = default)
    {
        var target = await ResolveInProgressTargetAsync(ct);
        if (target == null)
        {
            return false;
        }

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (nowMs < target.WindowStartMs + EntryGraceMs)
        {
            return false;
        }

        if (nowMs >= target.WindowEndMs)
        {
            return false;
        }

        return await TryRecordSkipAsync(settings, target.CandleTimeSec, target.Market, ct);
    }

    private async Task<InProgressTarget?> ResolveInProgressTargetAsync(CancellationToken ct)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var windows = await gamma.DiscoverBtc5mWindowsAsync(ct);
        var current = windows.Current;
        if (current?.WindowStartUtc is { } gammaStart)
        {
            var startMs = new DateTimeOffset(
                DateTime.SpecifyKind(gammaStart, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
            var endMs = current.WindowEndUtc is { } gammaEnd
                ? new DateTimeOffset(DateTime.SpecifyKind(gammaEnd, DateTimeKind.Utc)).ToUnixTimeMilliseconds()
                : startMs + 5 * 60 * 1000L;

            if (nowMs >= startMs && nowMs < endMs)
            {
                var market = await UpsertMarketAsync(current, ct);
                return new InProgressTarget(
                    new DateTimeOffset(gammaStart, TimeSpan.Zero).ToUnixTimeSeconds(),
                    startMs,
                    endMs,
                    market);
            }
        }

        var candles = binance.Candles;
        if (candles.Count == 0)
        {
            return null;
        }

        var latest = candles[^1];
        var defaultInterval = 300;
        var intervalSec = latest.Time > 0 && candles.Count >= 2
            ? (int)(latest.Time - candles[^2].Time)
            : defaultInterval;
        if (intervalSec <= 0)
        {
            intervalSec = defaultInterval;
        }

        var candleStartMs = latest.Time * 1000L;
        var candleEndMs = candleStartMs + intervalSec * 1000L;
        if (nowMs < candleStartMs || nowMs >= candleEndMs)
        {
            return null;
        }

        var discovered = await gamma.DiscoverMarketByWindowStartAsync(latest.Time, ct)
            ?? windows.Current
            ?? windows.NextScheduled;
        if (discovered == null)
        {
            return null;
        }

        var fallbackMarket = await UpsertMarketAsync(discovered, ct);
        var fbStartMs = fallbackMarket.WindowStartUtc is { } ws
            ? new DateTimeOffset(DateTime.SpecifyKind(ws, DateTimeKind.Utc)).ToUnixTimeMilliseconds()
            : candleStartMs;
        var fbEndMs = fallbackMarket.WindowEndUtc is { } we
            ? new DateTimeOffset(DateTime.SpecifyKind(we, DateTimeKind.Utc)).ToUnixTimeMilliseconds()
            : candleStartMs + intervalSec * 1000L;

        return new InProgressTarget(latest.Time, fbStartMs, fbEndMs, fallbackMarket);
    }

    private async Task<bool> TryRecordSkipAsync(
        EngineSettingsEntity settings,
        long candleTimeSec,
        MarketEntity market,
        CancellationToken ct)
    {
        var isPaper = settings.TradingMode == TradingMode.Paper;
        int contextId = 0;
        if (isPaper)
        {
            if (settings.ActivePaperAccountId is not int paperId)
            {
                logger.LogWarning(
                    "engine_stopped skip not recorded for candle {CandleTime}: no active paper account",
                    candleTimeSec);
                return false;
            }

            contextId = paperId;
        }

        var hasTrade = await db.Trades.AnyAsync(
            t => t.CandleTime == candleTimeSec
                && t.Mode == settings.TradingMode
                && t.PaperAccountId == contextId,
            ct);
        if (hasTrade)
        {
            return false;
        }

        var hasSkip = await db.SkippedBets.AnyAsync(
            s => s.CandleTime == candleTimeSec
                && s.Mode == settings.TradingMode
                && s.PaperAccountId == contextId
                && s.MarketId == market.Id,
            ct);
        if (hasSkip)
        {
            return false;
        }

        db.SkippedBets.Add(new SkippedBetEntity
        {
            CandleTime = candleTimeSec,
            MarketId = market.Id,
            Mode = settings.TradingMode,
            PaperAccountId = contextId,
            SkipReason = "engine_stopped",
        });

        await db.SaveChangesAsync(ct);
        logger.LogInformation(
            "Recorded engine_stopped skip for in-progress candle {CandleTime} mode={Mode} account={AccountId} market={MarketId}",
            candleTimeSec,
            settings.TradingMode,
            contextId,
            market.Id);
        return true;
    }

    private async Task<MarketEntity> UpsertMarketAsync(MarketEntity discovered, CancellationToken ct)
    {
        var existing = await db.Markets
            .FirstOrDefaultAsync(m => m.ConditionId == discovered.ConditionId, ct);

        if (existing != null)
        {
            existing.YesTokenId = discovered.YesTokenId;
            existing.NoTokenId = discovered.NoTokenId;
            existing.Slug = discovered.Slug ?? existing.Slug;
            existing.Title = discovered.Title ?? existing.Title;
            existing.WindowStartUtc = discovered.WindowStartUtc ?? existing.WindowStartUtc;
            existing.WindowEndUtc = discovered.WindowEndUtc ?? existing.WindowEndUtc;
            existing.IsActive = true;
            existing.UpdatedAt = DateTime.UtcNow;
            return existing;
        }

        discovered.IsActive = true;
        discovered.UpdatedAt = DateTime.UtcNow;
        db.Markets.Add(discovered);
        await db.SaveChangesAsync(ct);
        return discovered;
    }

    private sealed record InProgressTarget(
        long CandleTimeSec,
        long WindowStartMs,
        long WindowEndMs,
        MarketEntity Market);
}
