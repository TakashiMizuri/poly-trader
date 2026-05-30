using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Logging;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed record EntryPatienceRequest(
    long TargetCandleTime,
    int TradeContextId,
    TradingMode Mode,
    int MarketId,
    string YesTokenId,
    string NoTokenId,
    string OutcomeTokenId,
    TradeSide Side,
    MarketTrend Trend,
    string LiveEntryOrderMode,
    double InitialQuote,
    long WindowStartMs,
    Action ReleaseClaim);

public interface IEntryPatienceExecutor
{
    void Start(EntryPatienceRequest request);
}

public sealed class EntryPatienceExecutor : IEntryPatienceExecutor
{
    private static readonly TimeSpan PaperPollInterval = TimeSpan.FromSeconds(2);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IPolymarketClobService _clob;
    private readonly IPolymarketMarketWebSocket _marketWs;
    private readonly IEntryWaitTracker _entryWaitTracker;
    private readonly ITradingEventPublisher _publisher;
    private readonly ITradeExecutionLogger _tradeLog;
    private readonly EntryExecutionSettings _entryExecution;
    private readonly ILogger<EntryPatienceExecutor> _logger;

    /// <summary>One patience run per candle/mode/account (defense in depth vs duplicate CLOB orders).</summary>
    private readonly ConcurrentDictionary<string, byte> _runningPatience = new();

    public EntryPatienceExecutor(
        IServiceScopeFactory scopeFactory,
        IPolymarketClobService clob,
        IPolymarketMarketWebSocket marketWs,
        IEntryWaitTracker entryWaitTracker,
        ITradingEventPublisher publisher,
        ITradeExecutionLogger tradeLog,
        EntryExecutionSettings entryExecution,
        ILogger<EntryPatienceExecutor> logger)
    {
        _scopeFactory = scopeFactory;
        _clob = clob;
        _marketWs = marketWs;
        _entryWaitTracker = entryWaitTracker;
        _publisher = publisher;
        _tradeLog = tradeLog;
        _entryExecution = entryExecution;
        _logger = logger;
    }

    public void Start(EntryPatienceRequest request)
    {
        var runKey = PatienceRunKey(request);
        if (!_runningPatience.TryAdd(runKey, 0))
        {
            _logger.LogWarning(
                "Duplicate patience entry suppressed for candle {CandleTime} mode={Mode} account={AccountId}",
                request.TargetCandleTime,
                request.Mode,
                request.TradeContextId);
            return;
        }

        var startedUtc = DateTime.UtcNow;
        var wait = _entryExecution.ResolvePatienceWait(request.WindowStartMs);
        _entryWaitTracker.SetWaiting(new EntryWaitState(
            request.TargetCandleTime,
            request.Mode,
            request.TradeContextId,
            request.MarketId,
            request.Side.ToString(),
            request.Trend.ToString(),
            request.WindowStartMs,
            startedUtc,
            startedUtc.Add(wait)));

        _tradeLog.Information(
            "PATIENCE_START candle={CandleTime} mode={Mode} account={AccountId} side={Side} trend={Trend} "
            + "initialQuote={InitialQuote:F4} waitSeconds={WaitSeconds:F0} band=(0,{Max:F2}] token={TokenId}",
            request.TargetCandleTime,
            request.Mode,
            request.TradeContextId,
            request.Side,
            request.Trend,
            request.InitialQuote,
            wait.TotalSeconds,
            _entryExecution.PatienceMaxEntryPrice,
            request.OutcomeTokenId);
        _ = PublishFeedChangedSafeAsync();

        _ = Task.Run(async () =>
        {
            try
            {
                await RunAsync(request);
            }
            finally
            {
                _runningPatience.TryRemove(runKey, out _);
            }
        });
    }

    private static string PatienceRunKey(EntryPatienceRequest request) =>
        $"{request.Mode}:{request.TradeContextId}:{request.TargetCandleTime}";

    private async Task RunAsync(EntryPatienceRequest request)
    {
        var releaseEntryClaim = true;
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
            var settings = await db.EngineSettings.AsNoTracking().FirstOrDefaultAsync()
                ?? new EngineSettingsEntity();

            if (!settings.IsRunning)
            {
                _logger.LogInformation(
                    "Entry patience aborted for candle {CandleTime}: engine stopped",
                    request.TargetCandleTime);
                return;
            }

            if (await EntryAlreadyRecordedAsync(db, request, CancellationToken.None))
            {
                return;
            }

            var isLive = request.Mode == TradingMode.Live;
            var paperAccount = request.Mode == TradingMode.Paper
                ? await db.PaperAccounts.FirstOrDefaultAsync(a =>
                    a.Id == request.TradeContextId && !a.IsArchived)
                : null;

            if (request.Mode == TradingMode.Paper && paperAccount == null)
            {
                return;
            }

            double balanceAtOpen;
            if (isLive)
            {
                var liveBalance = await _clob.GetCollateralBalanceAsync();
                if (liveBalance is null)
                {
                    await RecordSkipAsync(
                        db,
                        settings,
                        request,
                        "balance_unavailable",
                        "Could not read live USDC balance during entry patience window");
                    return;
                }

                balanceAtOpen = liveBalance.Value;
            }
            else
            {
                balanceAtOpen = paperAccount!.Balance;
            }

            var stakeParams = settings.ToStrategyParams(balanceAtOpen);
            var stake = BetStakeResolver.ResolveForBalance(balanceAtOpen, stakeParams)
                ?? (settings.BetStakeMode == BetStakeMode.Fixed
                    ? settings.BetStakeUsd
                    : BetStakeResolver.RequestedStake(balanceAtOpen, stakeParams));

            stake = ApplyStakePlanForPatience(
                request.LiveEntryOrderMode,
                balanceAtOpen,
                stake,
                stakeParams.MaxBetStakeUsd ?? 500,
                _entryExecution.PatienceMaxEntryPrice,
                out var stakeBlockReason);
            if (stake <= 0)
            {
                await RecordSkipAsync(
                    db,
                    settings,
                    request,
                    stakeBlockReason?.Contains("balance", StringComparison.OrdinalIgnoreCase) == true
                        ? "insufficient_balance"
                        : "clob_min_order_size",
                    stakeBlockReason ?? "Cannot place patience entry");
                return;
            }

            if (isLive && (stake < SafeBetStake.MinBetStake || balanceAtOpen < SafeBetStake.MinBetStake))
            {
                await RecordSkipAsync(
                    db,
                    settings,
                    request,
                    "insufficient_balance",
                    $"Live balance ${balanceAtOpen:F2} below minimum stake during patience window");
                return;
            }

            if (await EntryAlreadyRecordedAsync(db, request, CancellationToken.None))
            {
                return;
            }

            var filled = isLive
                ? await TryLivePatienceFillAsync(request, stake)
                : await TryPaperPatienceFillAsync(request, stake);

            if (filled != null)
            {
                if (await EntryAlreadyRecordedAsync(db, request, CancellationToken.None))
                {
                    _logger.LogInformation(
                        "Patience fill suppressed for candle {CandleTime}: trade or skip already recorded",
                        request.TargetCandleTime);
                    return;
                }

                TradeRecording.ApplyStakeSnapshot(filled, balanceAtOpen, settings);

                try
                {
                    db.Trades.Add(filled);
                    await db.SaveChangesAsync();
                }
                catch (DbUpdateException ex) when (IsDuplicateTradeConstraint(ex))
                {
                    _logger.LogWarning(
                        "Patience trade duplicate suppressed for candle {CandleTime} (unique index)",
                        request.TargetCandleTime);
                    releaseEntryClaim = false;
                    return;
                }

                releaseEntryClaim = false;
                await db.Entry(filled).Reference(t => t.Market).LoadAsync();
                await _publisher.PublishTradePlacedAsync(TradeEventDtoFactory.FromEntity(filled));
                if (paperAccount != null)
                {
                    await _publisher.PublishBalanceUpdatedAsync(
                        paperAccount.Balance,
                        paperAccount.Id);
                }
                else if (isLive)
                {
                    var liveBal = await _clob.GetCollateralBalanceAsync();
                    if (liveBal is > 0)
                    {
                        await _publisher.PublishBalanceUpdatedAsync(liveBal.Value, 0);
                    }
                }

                _tradeLog.Information(
                    "PATIENCE_FILL candle={CandleTime} mode={Mode} side={Side} trend={Trend} entry={Entry:F4} "
                    + "stake=${Stake:F2} order={OrderId} token={TokenId}",
                    filled.CandleTime,
                    filled.Mode,
                    filled.Side,
                    filled.Trend,
                    filled.EntryPrice,
                    filled.StakeUsd,
                    filled.PolymarketOrderId ?? "(none)",
                    request.OutcomeTokenId);
                return;
            }

            await RecordSkipAsync(
                db,
                settings,
                request,
                "entry_price_out_of_range",
                $"No fill within {_entryExecution.ResolvePatienceWait(request.WindowStartMs).TotalSeconds:F0}s (initial quote {request.InitialQuote:F4}, patience band (0, {_entryExecution.PatienceMaxEntryPrice:F2}])");
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Entry patience failed for candle {CandleTime}",
                request.TargetCandleTime);
        }
        finally
        {
            _entryWaitTracker.Clear(
                request.TargetCandleTime,
                request.Mode,
                request.TradeContextId);
            await PublishFeedChangedSafeAsync();
            if (releaseEntryClaim)
            {
                request.ReleaseClaim();
            }
        }
    }

    private static bool IsDuplicateTradeConstraint(DbUpdateException ex) =>
        ex.InnerException is SqliteException sqlite
        && (sqlite.SqliteErrorCode == 19 || sqlite.SqliteExtendedErrorCode == 2067);

    private async Task<bool> EntryAlreadyRecordedAsync(
        PolyTraderDbContext db,
        EntryPatienceRequest request,
        CancellationToken ct)
    {
        var hasTrade = await db.Trades.AnyAsync(
            t => t.CandleTime == request.TargetCandleTime
                && t.Mode == request.Mode
                && t.PaperAccountId == request.TradeContextId,
            ct);
        if (hasTrade)
        {
            return true;
        }

        return await db.SkippedBets.AnyAsync(
            s => s.CandleTime == request.TargetCandleTime
                && s.Mode == request.Mode
                && s.PaperAccountId == request.TradeContextId,
            ct);
    }

    private async Task<TradeEntity?> TryLivePatienceFillAsync(
        EntryPatienceRequest request,
        double stake)
    {
        var ask = await ResolveAskPriceAsync(
            request.YesTokenId,
            request.NoTokenId,
            request.OutcomeTokenId,
            CancellationToken.None);

        var outcome = await _clob.PlacePatienceEntryOrderAsync(
            request.OutcomeTokenId,
            stake,
            ask,
            new LiveEntryOrderKey(request.TargetCandleTime, request.OutcomeTokenId),
            request.WindowStartMs,
            CancellationToken.None);

        if (!outcome.IsSuccess || outcome.Result == null)
        {
            _logger.LogInformation(
                "Patience live entry not filled candle {CandleTime}: {Reason}",
                request.TargetCandleTime,
                outcome.FailureReason ?? "no fill");
            return null;
        }

        var liveBuy = outcome.Result;
        var entryPrice = liveBuy.AveragePrice is > 0
            ? liveBuy.AveragePrice.Value
            : liveBuy.MatchedShares > 0 && liveBuy.FilledStakeUsd > 0
                ? liveBuy.FilledStakeUsd / liveBuy.MatchedShares
                : _entryExecution.PatienceMaxEntryPrice;

        if (!EntryPriceRules.IsPatienceFillAllowed(entryPrice))
        {
            _logger.LogWarning(
                "Patience live fill price {Price:F4} outside patience band; treating as no entry candle {CandleTime}",
                entryPrice,
                request.TargetCandleTime);
            return null;
        }

        string? entryWavesJson = null;
        if (liveBuy.EntryWaves is { Count: > 0 } waves)
        {
            entryWavesJson = TradeEntryWavesJson.Serialize(waves);
        }

        return new TradeEntity
        {
            CandleTime = request.TargetCandleTime,
            Side = request.Side,
            Trend = request.Trend,
            Mode = request.Mode,
            PaperAccountId = request.TradeContextId,
            StakeUsd = liveBuy.FilledStakeUsd,
            RequestedStakeUsd = liveBuy.RequestedStakeUsd,
            EntryPrice = entryPrice,
            Won = null,
            PnlUsd = null,
            PolymarketOrderId = liveBuy.OrderId,
            EntryWavesJson = entryWavesJson,
            MarketId = request.MarketId,
        };
    }

    private async Task<TradeEntity?> TryPaperPatienceFillAsync(
        EntryPatienceRequest request,
        double stake)
    {
        var deadline = DateTime.UtcNow + _entryExecution.ResolvePatienceWait(request.WindowStartMs);
        while (DateTime.UtcNow < deadline)
        {
            var bid = await ResolveMakerBidPriceAsync(
                request.YesTokenId,
                request.NoTokenId,
                request.OutcomeTokenId,
                CancellationToken.None);

            if (EntryPriceRules.IsPatienceFillAllowed(bid))
            {
                var entryPrice = Math.Min(bid, _entryExecution.PatienceMaxEntryPrice);
                var orderId = $"paper-patience-{Guid.NewGuid():N}";
                _logger.LogInformation(
                    "Paper patience fill @ {Price:F4} candle {CandleTime} stake ${Stake:F2}",
                    entryPrice,
                    request.TargetCandleTime,
                    stake);

                return new TradeEntity
                {
                    CandleTime = request.TargetCandleTime,
                    Side = request.Side,
                    Trend = request.Trend,
                    Mode = request.Mode,
                    PaperAccountId = request.TradeContextId,
                    StakeUsd = stake,
                    EntryPrice = entryPrice,
                    Won = null,
                    PnlUsd = null,
                    PolymarketOrderId = orderId,
                    MarketId = request.MarketId,
                };
            }

            await Task.Delay(PaperPollInterval);
        }

        return null;
    }

    private static double ApplyStakePlanForPatience(
        string entryOrderMode,
        double balanceAtOpen,
        double stake,
        double maxCap,
        double bidForSizing,
        out string? blockReason)
    {
        blockReason = null;
        var normalized = LiveEntryOrderModes.Normalize(entryOrderMode);

        if (LiveEntryOrderModes.IsLimitElseMarket(normalized))
        {
            var hybrid = HybridEntryRules.PlanLimitElseMarket(
                balanceAtOpen,
                stake,
                maxCap,
                bidForSizing);
            if (!hybrid.CanTrade || hybrid.UsedMarketFallback)
            {
                blockReason = hybrid.BlockReason
                    ?? $"Limit-only: need ≥ ${LimitEntryRules.MinStakeUsd(bidForSizing):F2} for {LimitEntryRules.MinOrderShares} shares @ bid {bidForSizing:F4}";
                return 0;
            }

            return hybrid.EffectiveStakeUsd;
        }

        if (LiveEntryOrderModes.UsesLimitBump(normalized))
        {
            var plan = LimitEntryRules.Plan(balanceAtOpen, stake, maxCap, bidForSizing);
            if (!plan.CanTrade)
            {
                blockReason = plan.BlockReason
                    ?? $"Need ≥ ${plan.ClobMinStakeUsd:F2} for {LimitEntryRules.MinOrderShares} shares at bid {bidForSizing:F4}";
                return 0;
            }

            return plan.EffectiveStakeUsd;
        }

        return stake;
    }

    private async Task RecordSkipAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        EntryPatienceRequest request,
        string skipReason,
        string? detail)
    {
        if (await EntryAlreadyRecordedAsync(db, request, CancellationToken.None))
        {
            return;
        }

        var hasSkip = await db.SkippedBets.AnyAsync(s =>
            s.CandleTime == request.TargetCandleTime
            && s.Mode == request.Mode
            && s.PaperAccountId == request.TradeContextId
            && s.MarketId == request.MarketId);
        if (hasSkip)
        {
            return;
        }

        db.SkippedBets.Add(new SkippedBetEntity
        {
            CandleTime = request.TargetCandleTime,
            MarketId = request.MarketId,
            Mode = request.Mode,
            PaperAccountId = request.TradeContextId,
            SkipReason = skipReason,
            SkipDetail = SkippedBetEntity.TruncateDetail(detail),
            Side = request.Side.ToString(),
            Trend = request.Trend.ToString(),
            InitialBid = request.InitialQuote,
            SignalPresent = true,
        });

        await db.SaveChangesAsync();

        _tradeLog.Warning(
            "PATIENCE_SKIP candle={CandleTime} mode={Mode} reason={Reason} detail={Detail} side={Side} trend={Trend}",
            request.TargetCandleTime,
            request.Mode,
            skipReason,
            detail ?? "(none)",
            request.Side,
            request.Trend);
        await PublishFeedChangedSafeAsync();

        var marketMeta = await db.Markets.AsNoTracking()
            .Where(m => m.Id == request.MarketId)
            .Select(m => new { m.Title, m.Slug })
            .FirstOrDefaultAsync();

        _logger.LogInformation(
            "Patience entry skip candle {CandleTime} reason={Reason} detail={Detail}",
            request.TargetCandleTime,
            skipReason,
            detail ?? "(none)");

        if (skipReason is "entry_price_out_of_range"
            or "order_failed"
            or "insufficient_balance"
            or "balance_unavailable"
            or "clob_min_order_size")
        {
            await _publisher.PublishEntryFailedAsync(new EntryFailedEvent(
                request.TargetCandleTime,
                request.Mode.ToString(),
                skipReason,
                detail,
                marketMeta?.Title,
                marketMeta?.Slug,
                request.Side.ToString(),
                request.Trend.ToString(),
                null));
        }
    }

    private async Task<double> ResolveMakerBidPriceAsync(
        string yesTokenId,
        string noTokenId,
        string outcomeTokenId,
        CancellationToken ct)
    {
        static bool IsValidPrice(double? p) => p is > 0 and <= 1;

        var fromWs = _marketWs.Prices.GetOrCreate(outcomeTokenId).MakerBuyPrice
            ?? _marketWs.Prices.GetMid(outcomeTokenId);
        if (IsValidPrice(fromWs))
        {
            return fromWs!.Value;
        }

        var fromRest = await _clob.TryGetBidPriceAsync(outcomeTokenId, ct)
            ?? await _clob.TryGetMidPriceAsync(outcomeTokenId, ct);
        if (IsValidPrice(fromRest))
        {
            return fromRest!.Value;
        }

        return 0;
    }

    private async Task<double> ResolveAskPriceAsync(
        string yesTokenId,
        string noTokenId,
        string outcomeTokenId,
        CancellationToken ct)
    {
        static bool IsValidPrice(double? p) => p is > 0 and <= 1;

        var fromWs = _marketWs.Prices.GetBuyPrice(outcomeTokenId)
            ?? _marketWs.Prices.GetMid(outcomeTokenId);
        if (IsValidPrice(fromWs))
        {
            return fromWs!.Value;
        }

        var fromRest = await _clob.TryGetBuyPriceAsync(outcomeTokenId, ct);
        if (IsValidPrice(fromRest))
        {
            return fromRest!.Value;
        }

        return 0;
    }

    private async Task PublishFeedChangedSafeAsync()
    {
        try
        {
            await _publisher.PublishPositionsFeedChangedAsync();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "PositionsFeedChanged publish failed");
        }
    }
}

internal static class TradeEventDtoFactory
{
    public static object FromEntity(TradeEntity t) => new
    {
        t.Id,
        t.CandleTime,
        side = t.Side.ToString(),
        trend = t.Trend.ToString(),
        mode = t.Mode.ToString(),
        t.StakeUsd,
        t.StakeBalanceUsd,
        betStakeMode = t.BetStakeMode?.ToString(),
        t.BetStakePercent,
        t.BetStakeFixedUsd,
        t.EntryPrice,
        t.Won,
        t.PnlUsd,
        t.WinPayoutRatio,
        t.PaperAccountId,
        t.PolymarketOrderId,
        market = t.Market == null
            ? null
            : new
            {
                t.Market.Title,
                t.Market.Slug,
                windowStartUtc = t.Market.WindowStartUtc,
                windowEndUtc = t.Market.WindowEndUtc,
            },
        t.CreatedAt,
    };
}
