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
    long? WindowEndMs,
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
        var windowEndMs = request.WindowEndMs ?? request.WindowStartMs + 300_000L;
        var wait = _entryExecution.ResolvePatienceWait(request.WindowStartMs, windowEndMs);
        if (wait.TotalSeconds < 10)
        {
            _logger.LogWarning(
                "Patience for candle {CandleTime} has only {WaitSeconds:F0}s left in market window (configured max {MaxSeconds}s)",
                request.TargetCandleTime,
                wait.TotalSeconds,
                _entryExecution.MaxWaitSeconds);
        }

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
                await RunAsync(request, startedUtc, windowEndMs);
            }
            finally
            {
                _runningPatience.TryRemove(runKey, out _);
            }
        });
    }

    private static string PatienceRunKey(EntryPatienceRequest request) =>
        $"{request.Mode}:{request.TradeContextId}:{request.TargetCandleTime}";

    private async Task RunAsync(EntryPatienceRequest request, DateTime startedUtc, long windowEndMs)
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
                await RecordSkipAsync(
                    db,
                    settings,
                    request,
                    "engine_stopped",
                    "Engine stopped before patience fill window completed");
                return;
            }

            if (await EntryAlreadyRecordedAsync(db, request, CancellationToken.None))
            {
                return;
            }

            var patienceWait = _entryExecution.ResolvePatienceWait(request.WindowStartMs, windowEndMs);
            if (patienceWait.TotalSeconds < EntryExecutionSettings.MinPatienceWaitSeconds)
            {
                await RecordSkipAsync(
                    db,
                    settings,
                    request,
                    "entry_price_out_of_range",
                    $"Patience window too short ({patienceWait.TotalSeconds:F0}s left, need ≥{EntryExecutionSettings.MinPatienceWaitSeconds}s "
                    + $"before 5m window end; initial quote {request.InitialQuote:F4}, band (0, {_entryExecution.PatienceMaxEntryPrice:F2}])");
                return;
            }

            RefreshEntryWaitExpiry(request, startedUtc, patienceWait);

            var isLive = request.Mode == TradingMode.Live;
            var paperAccount = request.Mode == TradingMode.Paper
                ? await db.PaperAccounts.FirstOrDefaultAsync(a =>
                    a.Id == request.TradeContextId && !a.IsArchived)
                : null;

            if (request.Mode == TradingMode.Paper && paperAccount == null)
            {
                await RecordSkipAsync(
                    db,
                    settings,
                    request,
                    "order_failed",
                    "Paper account not found or archived during patience window");
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

            var maxEntry = _entryExecution.PatienceMaxEntryPrice;
            PatienceFillAttemptResult fillAttempt;
            if (isLive)
            {
                fillAttempt = await TryLivePatienceFillAsync(
                    request,
                    stake,
                    maxEntry,
                    () => IsEngineRunningAsync(db, CancellationToken.None),
                    CancellationToken.None);
            }
            else
            {
                var paperTrade = await TryPaperPatienceFillAsync(request, stake, maxEntry, CancellationToken.None);
                fillAttempt = new PatienceFillAttemptResult(paperTrade, null, null);
            }

            var filled = fillAttempt.Trade;

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
                await PublishFeedChangedSafeAsync();
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

            var configuredWait = patienceWait;
            var actualWait = DateTime.UtcNow - startedUtc;
            var skipReason = fillAttempt.LastSkipReason
                ?? LiveEntryFailureClassifier.ToSkipReason(fillAttempt.LastFailureReason);
            var detail = fillAttempt.LastFailureReason != null
                ? $"No fill after {actualWait.TotalSeconds:F0}s patience (limit {configuredWait.TotalSeconds:F0}s): {fillAttempt.LastFailureReason}"
                : $"No fill after {actualWait.TotalSeconds:F0}s patience (limit {configuredWait.TotalSeconds:F0}s, initial quote {request.InitialQuote:F4}, band (0, {maxEntry:F2}])";
            await RecordSkipAsync(db, settings, request, skipReason, detail);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Entry patience failed for candle {CandleTime}",
                request.TargetCandleTime);
            try
            {
                await using var errScope = _scopeFactory.CreateAsyncScope();
                var errDb = errScope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
                var errSettings = await errDb.EngineSettings.AsNoTracking().FirstOrDefaultAsync()
                    ?? new EngineSettingsEntity();
                await RecordSkipAsync(
                    errDb,
                    errSettings,
                    request,
                    "order_failed",
                    $"Patience task failed: {ex.Message}");
            }
            catch (Exception recordEx)
            {
                _logger.LogError(recordEx, "Failed to record patience error skip for candle {CandleTime}", request.TargetCandleTime);
            }
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

    private sealed record PatienceFillAttemptResult(
        TradeEntity? Trade,
        string? LastFailureReason,
        string? LastSkipReason);

    private void RefreshEntryWaitExpiry(
        EntryPatienceRequest request,
        DateTime startedUtc,
        TimeSpan patienceWait)
    {
        var expiresUtc = DateTime.UtcNow.Add(patienceWait);
        _entryWaitTracker.SetWaiting(new EntryWaitState(
            request.TargetCandleTime,
            request.Mode,
            request.TradeContextId,
            request.MarketId,
            request.Side.ToString(),
            request.Trend.ToString(),
            request.WindowStartMs,
            startedUtc,
            expiresUtc));
    }

    private static async Task<bool> IsEngineRunningAsync(
        PolyTraderDbContext db,
        CancellationToken ct) =>
        (await db.EngineSettings.AsNoTracking().FirstOrDefaultAsync(ct))?.IsRunning == true;

    private async Task<PatienceFillAttemptResult> TryLivePatienceFillAsync(
        EntryPatienceRequest request,
        double stake,
        double maxEntryPrice,
        Func<Task<bool>> isEngineRunning,
        CancellationToken ct)
    {
        var windowEndMs = request.WindowEndMs ?? request.WindowStartMs + 300_000L;
        var deadline = DateTime.UtcNow + _entryExecution.ResolvePatienceWait(request.WindowStartMs, windowEndMs);
        const int maxSliceSeconds = 20;
        var useMarket = LiveEntryOrderModes.IsMarket(
            LiveEntryOrderModes.Normalize(request.LiveEntryOrderMode));
        string? lastFailure = null;
        string? lastSkipReason = null;
        var patienceAttempt = 0;

        while (DateTime.UtcNow < deadline)
        {
            if (!await isEngineRunning())
            {
                lastFailure = "Engine stopped during patience window";
                lastSkipReason = "engine_stopped";
                break;
            }

            var bid = await ResolveMakerBidPriceAsync(
                request.YesTokenId,
                request.NoTokenId,
                request.OutcomeTokenId,
                ct);

            if (bid <= 0)
            {
                lastFailure = "Quote unavailable (no bid from WS/REST)";
                lastSkipReason = LiveEntryFailureClassifier.QuoteUnavailable;
                await Task.Delay(PaperPollInterval, ct);
                continue;
            }

            if (!EntryPriceRules.IsPatienceFillAllowed(bid, maxEntryPrice))
            {
                await Task.Delay(PaperPollInterval, ct);
                continue;
            }

            var remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero)
            {
                break;
            }

            var sliceWait = TimeSpan.FromSeconds(
                Math.Min(remaining.TotalSeconds, maxSliceSeconds));

            var ask = await ResolveAskPriceAsync(
                request.YesTokenId,
                request.NoTokenId,
                request.OutcomeTokenId,
                ct);

            var entryKey = new LiveEntryOrderKey(
                request.TargetCandleTime,
                request.OutcomeTokenId,
                patienceAttempt);
            patienceAttempt++;

            LiveMarketBuyOutcome outcome;
            if (useMarket)
            {
                outcome = await _clob.PlaceEntryOrderAsync(
                    request.OutcomeTokenId,
                    stake,
                    LiveEntryOrderModes.Market,
                    bid,
                    ask,
                    entryKey,
                    ct);
            }
            else
            {
                outcome = await _clob.PlacePatienceEntryOrderAsync(
                    request.OutcomeTokenId,
                    stake,
                    bid,
                    ask,
                    entryKey,
                    sliceWait,
                    ct);
            }

            if (!outcome.IsSuccess || outcome.Result == null)
            {
                lastFailure = outcome.FailureReason ?? "no fill";
                lastSkipReason = LiveEntryFailureClassifier.ToSkipReason(lastFailure);
                _logger.LogDebug(
                    "Patience live attempt {Attempt} not filled candle {CandleTime} bid {Bid:F4}: {Reason}",
                    patienceAttempt,
                    request.TargetCandleTime,
                    bid,
                    lastFailure);
                await Task.Delay(PaperPollInterval, ct);
                continue;
            }

            var trade = BuildTradeFromLiveBuy(request, outcome.Result, bid, maxEntryPrice);
            if (trade == null)
            {
                lastFailure = "Patience fill could not be built from CLOB result";
                lastSkipReason = LiveEntryFailureClassifier.OrderFailed;
                await Task.Delay(PaperPollInterval, ct);
                continue;
            }

            return new PatienceFillAttemptResult(trade, null, null);
        }

        return new PatienceFillAttemptResult(null, lastFailure, lastSkipReason);
    }

    private TradeEntity? BuildTradeFromLiveBuy(
        EntryPatienceRequest request,
        LiveMarketBuyResult liveBuy,
        double bidFallback,
        double maxEntryPrice)
    {
        var entryPrice = liveBuy.AveragePrice is > 0
            ? liveBuy.AveragePrice.Value
            : liveBuy.MatchedShares > 0 && liveBuy.FilledStakeUsd > 0
                ? liveBuy.FilledStakeUsd / liveBuy.MatchedShares
                : bidFallback;

        if (liveBuy.FilledStakeUsd <= 0 && liveBuy.MatchedShares < PolymarketRestTradingClient.MinMatchedShares)
        {
            return null;
        }

        if (!EntryPriceRules.IsAllowed(entryPrice, maxEntryPrice))
        {
            _tradeLog.Warning(
                "PATIENCE_FILL_ABOVE_BAND candle={CandleTime} entry={Entry:F4} band=(0,{Max:F2}] — recording exchange fill",
                request.TargetCandleTime,
                entryPrice,
                maxEntryPrice);
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
        double stake,
        double maxEntryPrice,
        CancellationToken ct)
    {
        var windowEndMs = request.WindowEndMs ?? request.WindowStartMs + 300_000L;
        var deadline = DateTime.UtcNow + _entryExecution.ResolvePatienceWait(request.WindowStartMs, windowEndMs);
        while (DateTime.UtcNow < deadline)
        {
            var bid = await ResolveMakerBidPriceAsync(
                request.YesTokenId,
                request.NoTokenId,
                request.OutcomeTokenId,
                ct);

            if (bid <= 0)
            {
                await Task.Delay(PaperPollInterval, ct);
                continue;
            }

            if (EntryPriceRules.IsPatienceFillAllowed(bid, maxEntryPrice))
            {
                var entryPrice = Math.Min(bid, maxEntryPrice);
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

            await Task.Delay(PaperPollInterval, ct);
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

        EntryAuditLog.Skip(
            request.TargetCandleTime,
            request.Mode.ToString(),
            skipReason,
            detail,
            request.Side.ToString(),
            request.Trend.ToString());

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
            or "clob_min_order_size"
            or "quote_unavailable"
            or "engine_stopped")
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

