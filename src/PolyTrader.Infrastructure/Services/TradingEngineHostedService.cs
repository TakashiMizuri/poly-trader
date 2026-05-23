using Microsoft.EntityFrameworkCore;

using Microsoft.Extensions.DependencyInjection;

using Microsoft.Extensions.Hosting;

using Microsoft.Extensions.Logging;

using PolyTrader.Core.Abstractions;

using PolyTrader.Core.Models;

using PolyTrader.Core.Strategy;

using Microsoft.Extensions.Options;

using PolyTrader.Infrastructure.Binance;

using PolyTrader.Infrastructure.Data;

using PolyTrader.Infrastructure.Entities;

using PolyTrader.Infrastructure.Options;

using PolyTrader.Infrastructure.Polymarket;



namespace PolyTrader.Infrastructure.Services;



public sealed class TradingEngineHostedService : BackgroundService

{
    /// <summary>Live entries use post-only maker limits — Polymarket charges 0% maker fee.</summary>
    private const double LiveTradeCommissionPercent = 0;

    private readonly IServiceScopeFactory _scopeFactory;

    private readonly IBinanceMarketService _binance;

    private readonly IPolymarketGammaService _gamma;

    private readonly IPolymarketMarketWebSocket _marketWs;

    private readonly IPolymarketClobService _clob;

    private readonly ILiveTradeSettlementService _liveSettlement;

    private readonly IPolymarketRedeemService _redeem;

    private readonly ITradingEventPublisher _publisher;

    private readonly PolyTraderOptions _options;

    private readonly ILogger<TradingEngineHostedService> _logger;

    private MarketEntity? _activeMarket;

    private long? _lastSeenLatestCandleTime;

    /// <summary>
    /// Closed candle times for which strategy evaluation already ran (kline_close or backup).
    /// Prevents duplicate live orders when both paths race before the first trade is saved.
    /// </summary>
    private readonly HashSet<long> _evaluatedCloseTimes = [];

    /// <summary>
    /// Entry target candle times for which an open is in progress or completed this session.
    /// </summary>
    private readonly HashSet<long> _claimedEntryTargets = [];

    private readonly object _entryDedupLock = new();



    public TradingEngineHostedService(

        IServiceScopeFactory scopeFactory,

        IBinanceMarketService binance,

        IPolymarketGammaService gamma,

        IPolymarketMarketWebSocket marketWs,

        IPolymarketClobService clob,

        ILiveTradeSettlementService liveSettlement,

        IPolymarketRedeemService redeem,

        ITradingEventPublisher publisher,

        IOptions<PolyTraderOptions> options,

        ILogger<TradingEngineHostedService> logger)

    {

        _scopeFactory = scopeFactory;

        _binance = binance;

        _gamma = gamma;

        _marketWs = marketWs;

        _clob = clob;

        _liveSettlement = liveSettlement;

        _redeem = redeem;

        _publisher = publisher;

        _options = options.Value;

        _logger = logger;

    }



    protected override async Task ExecuteAsync(CancellationToken stoppingToken)

    {

        _logger.LogInformation(
            "Trading engine starting (symbol={Symbol}, interval={Interval})",
            _options.BinanceSymbol,
            _options.BinanceInterval);

        _binance.KlineClosed += OnKlineClosed;
        _binance.CandlesUpdated += OnCandlesUpdated;

        _marketWs.MarketResolved += async (_, _) => await RefreshMarketAsync(stoppingToken);



        await _binance.StartAsync(stoppingToken);

        await RefreshMarketAsync(stoppingToken);

        await RecoverOnStartupAsync(stoppingToken);

        _logger.LogInformation("Trading engine ready; market refresh every 2 minutes");

        while (!stoppingToken.IsCancellationRequested)

        {

            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);

            if (_activeMarket == null)

            {

                await RefreshMarketAsync(stoppingToken);

            }

        }

    }



    private async void OnKlineClosed(object? sender, BinanceKlineClosedEventArgs e)

    {

        try

        {

            await HandleKlineClosedAsync(e);

        }

        catch (Exception ex)

        {

            _logger.LogError(ex, "Error handling kline close");

        }

    }



    private async void OnCandlesUpdated(object? sender, EventArgs e)

    {

        try

        {

            await TryEvaluateOnNewBarOpenAsync();

        }

        catch (Exception ex)

        {

            _logger.LogError(ex, "Error handling new bar open");

        }

    }



    /// <summary>
    /// Backup path when kline-close fires late: at first tick of a new 5m bar, run the same
    /// close→next-entry logic using the previous bar as closed.
    /// </summary>
    private async Task TryEvaluateOnNewBarOpenAsync()

    {

        var candles = _binance.Candles;

        if (candles.Count < 2) return;

        var latest = candles[^1];

        if (_lastSeenLatestCandleTime == latest.Time) return;

        var previousLatest = _lastSeenLatestCandleTime;

        _lastSeenLatestCandleTime = latest.Time;

        if (previousLatest == null) return;

        var defaultInterval = CandleIntervalHelper.ParseBinanceIntervalSeconds(_options.BinanceInterval);

        var intervalSeconds = CandleIntervalHelper.InferIntervalSeconds(candles, defaultInterval);

        if (intervalSeconds <= 0) return;

        var previousOpenTime = latest.Time - intervalSeconds;

        var closedCandle = candles.FirstOrDefault(c => c.Time == previousOpenTime);

        if (closedCandle == null) return;

        try
        {
            // WS gaps leave provisional closes in RAM; REST is authoritative before entry/settlement.
            await _binance.RefreshRecentCandlesAsync(limit: 100, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "bar_open_backup: failed to refresh recent Binance klines; using in-memory buffer");
        }

        candles = _binance.Candles;
        closedCandle = candles.FirstOrDefault(c => c.Time == previousOpenTime);
        if (closedCandle == null) return;

        var closedBuffer = TrimBufferThroughClosedCandle(candles, closedCandle.Time);

        if (closedBuffer.Count == 0) return;

        await using var scope = _scopeFactory.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();

        var settings = await db.EngineSettings.FirstOrDefaultAsync() ?? new EngineSettingsEntity();

        if (!settings.IsRunning) return;

        if (settings.TradingMode == TradingMode.Paper && settings.ActivePaperAccountId is not int paperId)

        {

            return;

        }

        var tradeContextId = settings.TradingMode == TradingMode.Paper ? settings.ActivePaperAccountId!.Value : 0;

        var hasRecord = await db.Trades.AnyAsync(t =>

                t.CandleTime == latest.Time

                && t.Mode == settings.TradingMode

                && t.PaperAccountId == tradeContextId)

            || await db.SkippedBets.AnyAsync(s =>

                s.CandleTime == latest.Time

                && s.Mode == settings.TradingMode

                && s.PaperAccountId == tradeContextId);

        if (hasRecord) return;

        var paperAccount = settings.TradingMode == TradingMode.Paper

            ? await db.PaperAccounts.FirstOrDefaultAsync(a => a.Id == tradeContextId && !a.IsArchived)

            : null;

        if (settings.TradingMode == TradingMode.Paper && paperAccount == null) return;

        var workingBalance = await GetWorkingBalanceAsync(settings, paperAccount, CancellationToken.None);
        var strategyParams = settings.ToStrategyParams(workingBalance);

        var nextBar = candles.FirstOrDefault(c => c.Time == latest.Time);

        var actions = TrendBetStrategySimulator.ProcessCandleClose(

            closedCandle,

            closedBuffer,

            intervalSeconds,

            strategyParams,

            nextBar);

        if (actions == null) return;

        if (!TryClaimCloseEvaluation(closedCandle.Time))
        {
            _logger.LogDebug(
                "bar_open_backup skipped: close {ClosedTime} already evaluated",
                closedCandle.Time);
            return;
        }

        LogCandleDecision("bar_open_backup", closedCandle.Time, latest.Time, actions);

        var entryFailedToPublish = new List<EntryFailedEvent>();
        var tradesToPublish = await ApplyStrategyActionsAsync(
            db,
            settings,
            tradeContextId,
            paperAccount,
            closedCandle,
            intervalSeconds,
            actions,
            workingBalance,
            entryFailedToPublish);

        await db.SaveChangesAsync();

        await PublishTradesAndBalanceAsync(db, tradesToPublish, paperAccount, CancellationToken.None);
        await PublishEntryFailedEventsAsync(entryFailedToPublish, CancellationToken.None);
    }



    private async Task HandleKlineClosedAsync(BinanceKlineClosedEventArgs e)

    {

        await using var scope = _scopeFactory.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();

        var settings = await db.EngineSettings.FirstOrDefaultAsync() ?? new EngineSettingsEntity();

        _logger.LogDebug(
            "Kline closed {CandleTime} O={Open} H={High} L={Low} C={Close} running={Running} mode={Mode}",
            e.Candle.Time,
            e.Candle.Open,
            e.Candle.High,
            e.Candle.Low,
            e.Candle.Close,
            settings.IsRunning,
            settings.TradingMode);

        var isPaper = settings.TradingMode == TradingMode.Paper;
        var tradeContextId = 0;
        if (isPaper)
        {
            if (settings.ActivePaperAccountId is not int paperId)
            {
                await TryRecordSkipAsync(db, settings, e.Candle.Time, null, "engine_stopped", marketId: null);
                var liveBal = await _clob.GetCollateralBalanceAsync(CancellationToken.None);
                await BalanceSnapshotRecorder.RecordAsync(
                    db,
                    0,
                    e.Candle.Time,
                    liveBal ?? 0,
                    "Live",
                    CancellationToken.None);
                await db.SaveChangesAsync();
                return;
            }
            tradeContextId = paperId;
        }

        if (!settings.IsRunning)
        {
            await TryRecordSkipAsync(
                db,
                settings,
                e.Candle.Time,
                tradeContextId == 0 ? null : tradeContextId,
                "engine_stopped",
                marketId: null);

            PaperAccountEntity? stoppedPaper = null;
            if (isPaper)
            {
                stoppedPaper = await db.PaperAccounts.FirstOrDefaultAsync(
                    a => a.Id == tradeContextId && !a.IsArchived);
            }

            var stoppedBalance = await GetWorkingBalanceAsync(settings, stoppedPaper, CancellationToken.None);
            await RecordCandleBalanceSnapshotAsync(
                db,
                settings,
                stoppedPaper,
                tradeContextId,
                e.Candle.Time,
                stoppedBalance,
                CancellationToken.None);
            await db.SaveChangesAsync();
            return;
        }

        PaperAccountEntity? paperAccount = null;

        if (isPaper)
        {
            paperAccount = await db.PaperAccounts.FirstOrDefaultAsync(a => a.Id == tradeContextId && !a.IsArchived);
            if (paperAccount == null)
            {
                _logger.LogWarning("Active paper account {Id} missing or archived; skipping candle", tradeContextId);
                await db.SaveChangesAsync();
                return;
            }
        }



        var workingBalance = await GetWorkingBalanceAsync(settings, paperAccount, CancellationToken.None);

        var snap = await db.CandleSnapshots.FindAsync(e.Candle.Time);

        if (snap == null)

        {

            db.CandleSnapshots.Add(new CandleSnapshotEntity

            {

                Time = e.Candle.Time,

                Open = e.Candle.Open,

                High = e.Candle.High,

                Low = e.Candle.Low,

                Close = e.Candle.Close

            });

        }

        else

        {

            snap.Open = e.Candle.Open;

            snap.High = e.Candle.High;

            snap.Low = e.Candle.Low;

            snap.Close = e.Candle.Close;

            snap.RecordedAt = DateTime.UtcNow;

        }



        await _publisher.PublishCandleClosedAsync(e.Candle.Time);



        var strategyParams = settings.ToStrategyParams(workingBalance);



        var defaultInterval = CandleIntervalHelper.ParseBinanceIntervalSeconds(_options.BinanceInterval);

        var closedBuffer = TrimBufferThroughClosedCandle(_binance.Candles, e.Candle.Time);
        if (closedBuffer.Count == 0)
        {
            closedBuffer = TrimBufferThroughClosedCandle(e.Buffer, e.Candle.Time);
        }

        if (closedBuffer.Count == 0)
        {
            _logger.LogWarning(
                "Kline close {CandleTime} not found in buffer (service={ServiceCount}, event={EventCount}); skipping strategy",
                e.Candle.Time,
                _binance.Candles.Count,
                e.Buffer.Count);
            await db.SaveChangesAsync();
            return;
        }

        var intervalSeconds = CandleIntervalHelper.InferIntervalSeconds(closedBuffer, defaultInterval);

        var nextOpenTime = e.Candle.Time + intervalSeconds;
        var nextBar = _binance.Candles.FirstOrDefault(c => c.Time == nextOpenTime);



        var actions = TrendBetStrategySimulator.ProcessCandleClose(

            e.Candle,

            closedBuffer,

            intervalSeconds,

            strategyParams,

            nextBar);



        if (actions == null)

        {
            _logger.LogWarning(
                "Strategy returned null for closed candle {CandleTime} (trimmed buffer={Count})",
                e.Candle.Time,
                closedBuffer.Count);
            await db.SaveChangesAsync();

            return;

        }

        if (!TryClaimCloseEvaluation(e.Candle.Time))
        {
            _logger.LogDebug(
                "kline_closed skipped: close {ClosedTime} already evaluated",
                e.Candle.Time);
            await db.SaveChangesAsync();
            return;
        }

        LogCandleDecision("kline_closed", e.Candle.Time, nextOpenTime, actions);

        var entryFailedToPublish = new List<EntryFailedEvent>();
        var tradesToPublish = await ApplyStrategyActionsAsync(
            db,
            settings,
            tradeContextId,
            paperAccount,
            e.Candle,
            intervalSeconds,
            actions,
            workingBalance,
            entryFailedToPublish);

        await db.SaveChangesAsync();

        await PublishTradesAndBalanceAsync(db, tradesToPublish, paperAccount, CancellationToken.None);
        await PublishEntryFailedEventsAsync(entryFailedToPublish, CancellationToken.None);
    }

    private async Task PublishEntryFailedEventsAsync(
        IReadOnlyList<EntryFailedEvent> events,
        CancellationToken ct)
    {
        if (events.Count == 0)
        {
            return;
        }

        foreach (var entryFailed in events)
        {
            await _publisher.PublishEntryFailedAsync(entryFailed, ct);
        }
    }

    private async Task PublishTradesAndBalanceAsync(
        PolyTraderDbContext db,
        List<TradeEntity> trades,
        PaperAccountEntity? paperAccount,
        CancellationToken ct)
    {
        if (trades.Count == 0)
        {
            return;
        }

        _logger.LogInformation(
            "Publishing {Count} trade event(s) to clients",
            trades.Count);

        foreach (var trade in trades)
        {
            await db.Entry(trade).Reference(t => t.Market).LoadAsync(ct);
            await _publisher.PublishTradePlacedAsync(ToTradeEventDto(trade), ct);
        }

        if (paperAccount != null && trades.Exists(t => t.Won != null))
        {
            _logger.LogInformation(
                "Publishing paper balance update account={AccountId} balance=${Balance:F2}",
                paperAccount.Id,
                paperAccount.Balance);
            await _publisher.PublishBalanceUpdatedAsync(
                paperAccount.Balance,
                paperAccount.Id,
                ct);
        }
        else if (trades.Exists(t => t.Mode == TradingMode.Live))
        {
            var liveBal = await _clob.GetCollateralBalanceAsync(ct);
            if (liveBal is > 0)
            {
                _logger.LogInformation(
                    "Publishing live balance update balance=${Balance:F2}",
                    liveBal.Value);
                await _publisher.PublishBalanceUpdatedAsync(liveBal.Value, 0, ct);
            }
        }
    }

    private async Task<List<TradeEntity>> ApplyStrategyActionsAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        int tradeContextId,
        PaperAccountEntity? paperAccount,
        ChartCandle closedCandle,
        long intervalSeconds,
        CandleCloseStrategyResult actions,
        double workingBalance,
        List<EntryFailedEvent> entryFailedToPublish,
        CancellationToken ct = default)
    {
        var isPaper = settings.TradingMode == TradingMode.Paper;
        var isLive = settings.TradingMode == TradingMode.Live;
        var tradesToPublish = new List<TradeEntity>();
        var balanceChanged = false;

        if (actions.Settlement != null)
        {
            var openTrade = await db.Trades.FirstOrDefaultAsync(t =>
                    t.CandleTime == actions.Settlement.CandleTime
                    && t.Mode == settings.TradingMode
                    && t.PaperAccountId == tradeContextId
                    && t.Won == null,
                ct);

            if (openTrade != null)
            {
                bool won;
                if (isLive)
                {
                    if (openTrade.Market == null && openTrade.MarketId is > 0)
                    {
                        await db.Entry(openTrade).Reference(t => t.Market).LoadAsync(ct);
                    }

                    var liveWon = await _liveSettlement.TryResolveOutcomeAsync(openTrade, closedCandle, ct);
                    if (liveWon == null)
                    {
                        _logger.LogWarning(
                            "Live settlement deferred for trade {TradeId} candle {CandleTime}",
                            openTrade.Id,
                            openTrade.CandleTime);
                    }
                    else
                    {
                        won = liveWon.Value;
                        openTrade.Won = won;
                        var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
                            won,
                            openTrade.StakeUsd,
                            LiveTradeCommissionPercent,
                            openTrade.EntryPrice);
                        openTrade.PnlUsd = pnl;
                        db.Trades.Update(openTrade);
                        tradesToPublish.Add(openTrade);
                        LogTradeClosed(openTrade, won, pnl, paperAccount?.Balance);

                        if (won
                            && settings.AutoRedeemEnabled
                            && !string.IsNullOrWhiteSpace(openTrade.Market?.ConditionId))
                        {
                            _ = TriggerRedeemForConditionAsync(
                                openTrade.Market.ConditionId,
                                openTrade.CandleTime);
                        }
                    }
                }
                else
                {
                    won = actions.Settlement.Won;
                    openTrade.Won = won;
                    var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
                        won,
                        openTrade.StakeUsd,
                        settings.CommissionPercent,
                        openTrade.EntryPrice);
                    openTrade.PnlUsd = pnl;

                    if (isPaper && paperAccount != null)
                    {
                        paperAccount.Balance += pnl;
                        paperAccount.UpdatedAt = DateTime.UtcNow;
                        balanceChanged = true;
                    }

                    db.Trades.Update(openTrade);
                    tradesToPublish.Add(openTrade);
                    LogTradeClosed(openTrade, won, pnl, paperAccount?.Balance);
                }
            }
        }

        if (actions.Entry != null)
        {
            var targetCandleTime = actions.Entry.TargetCandleTime;

            if (!TryClaimEntryTarget(targetCandleTime))
            {
                _logger.LogWarning(
                    "Duplicate entry suppressed for candle {CandleTime} mode={Mode} account={AccountId}",
                    targetCandleTime,
                    settings.TradingMode,
                    tradeContextId);
            }
            else
            {
            var entryExists = await db.Trades.AnyAsync(t =>
                    t.CandleTime == targetCandleTime
                    && t.Mode == settings.TradingMode
                    && t.PaperAccountId == tradeContextId,
                ct);

            if (entryExists)
            {
                ReleaseEntryTargetClaim(targetCandleTime);
            }

            if (!entryExists)
            {
                var entryMarket = await ResolveMarketForCandleAsync(
                    db,
                    actions.Entry.TargetCandleTime,
                    ct);

                if (entryMarket == null)
                {
                    ReleaseEntryTargetClaim(targetCandleTime);
                    _logger.LogWarning(
                        "No Polymarket market for candle {CandleTime}; recording skip",
                        actions.Entry.TargetCandleTime);

                    await TryRecordSkipAsync(
                        db,
                        settings,
                        actions.Entry.TargetCandleTime,
                        tradeContextId,
                        "no_market",
                        marketId: null,
                        detail: "No Polymarket BTC 5m market resolved for entry candle",
                        trend: actions.Entry.Trend.ToString(),
                        entryFailedToPublish: entryFailedToPublish,
                        ct: ct);
                }
                else
                {
                    _activeMarket = entryMarket;

                    var side = actions.Entry.Trend == MarketTrend.Long ? TradeSide.Up : TradeSide.Down;
                    var tokenId = side == TradeSide.Up
                        ? entryMarket.YesTokenId
                        : entryMarket.NoTokenId;
                    var askPrice = await ResolveAskPriceAsync(
                        entryMarket.YesTokenId,
                        entryMarket.NoTokenId,
                        tokenId,
                        ct);
                    var useLimitEntry = !LiveEntryOrderModes.IsMarket(settings.LiveEntryOrderMode);
                    var bidPrice = useLimitEntry
                        ? await ResolveMakerBidPriceAsync(
                            entryMarket.YesTokenId,
                            entryMarket.NoTokenId,
                            tokenId,
                            ct)
                        : askPrice;
                    var entryPrice = useLimitEntry ? bidPrice : askPrice;

                    string? orderId = null;
                    var balanceUnavailable = false;
                    double balanceAtOpen = 0;
                    if (isPaper)
                    {
                        balanceAtOpen = paperAccount?.Balance ?? 0;
                    }
                    else
                    {
                        var liveBalance = await _clob.GetCollateralBalanceAsync(ct);
                        if (liveBalance is null)
                        {
                            balanceUnavailable = true;
                            ReleaseEntryTargetClaim(targetCandleTime);
                            _logger.LogWarning(
                                "Live entry skipped for candle {CandleTime}: CLOB balance unavailable (check connectivity / Polymarket API)",
                                actions.Entry.TargetCandleTime);
                            await TryRecordSkipAsync(
                                db,
                                settings,
                                actions.Entry.TargetCandleTime,
                                tradeContextId,
                                "balance_unavailable",
                                entryMarket.Id,
                                "Could not read live USDC balance from Polymarket CLOB (timeout or network error)",
                                side: side.ToString(),
                                trend: actions.Entry.Trend.ToString(),
                                entryFailedToPublish: entryFailedToPublish,
                                ct: ct);
                        }
                        else
                        {
                            balanceAtOpen = liveBalance.Value;
                        }
                    }

                    if (balanceUnavailable)
                    {
                        // skip entry; balance_unavailable already recorded
                    }
                    else
                    {
                    var stakeParams = settings.ToStrategyParams(balanceAtOpen);
                    var stake = BetStakeResolver.ResolveForBalance(balanceAtOpen, stakeParams)
                        ?? (settings.BetStakeMode == BetStakeMode.Fixed
                            ? settings.BetStakeUsd
                            : BetStakeResolver.RequestedStake(balanceAtOpen, stakeParams));

                    if (useLimitEntry)
                    {
                        var limitPlan = LimitEntryRules.Plan(
                            balanceAtOpen,
                            stake,
                            stakeParams.MaxBetStakeUsd,
                            bidPrice);
                        if (limitPlan.WillBump)
                        {
                            _logger.LogInformation(
                                "Bumping {Mode} stake ${Old:F2} → ${New:F2} for Polymarket min order ({MinShares} shares @ bid {Bid:F4})",
                                settings.TradingMode,
                                stake,
                                limitPlan.EffectiveStakeUsd,
                                LimitEntryRules.MinOrderShares,
                                bidPrice);
                        }

                        if (!limitPlan.CanTrade)
                        {
                            ReleaseEntryTargetClaim(targetCandleTime);
                            _logger.LogWarning(
                                "{Mode} limit entry skipped for candle {CandleTime}: {Reason}",
                                settings.TradingMode,
                                actions.Entry.TargetCandleTime,
                                limitPlan.BlockReason);
                            await TryRecordSkipAsync(
                                db,
                                settings,
                                actions.Entry.TargetCandleTime,
                                tradeContextId,
                                "clob_min_order_size",
                                entryMarket.Id,
                                limitPlan.BlockReason
                                    ?? $"Need ≥ ${limitPlan.ClobMinStakeUsd:F2} for {LimitEntryRules.MinOrderShares} shares at bid {bidPrice:F4}",
                                side: side.ToString(),
                                trend: actions.Entry.Trend.ToString(),
                                stakeUsd: stake,
                                entryFailedToPublish: entryFailedToPublish,
                                ct: ct);
                            stake = 0;
                        }
                        else
                        {
                            stake = limitPlan.EffectiveStakeUsd;
                        }
                    }

                    if (stake <= 0)
                    {
                        // clob_min_order_size skip already recorded
                    }
                    else if (isLive && (stake < SafeBetStake.MinBetStake || balanceAtOpen < SafeBetStake.MinBetStake))
                    {
                        ReleaseEntryTargetClaim(targetCandleTime);
                        _logger.LogWarning(
                            "Live entry skipped for candle {CandleTime}: insufficient balance ${Balance:F2}",
                            actions.Entry.TargetCandleTime,
                            balanceAtOpen);
                        await TryRecordSkipAsync(
                            db,
                            settings,
                            actions.Entry.TargetCandleTime,
                            tradeContextId,
                            "insufficient_balance",
                            entryMarket.Id,
                            $"Live balance ${balanceAtOpen:F2} below minimum stake (requested ${stake:F2}, min ${SafeBetStake.MinBetStake:F2})",
                            side: side.ToString(),
                            trend: actions.Entry.Trend.ToString(),
                            stakeUsd: stake,
                            entryFailedToPublish: entryFailedToPublish,
                            ct: ct);
                    }
                    else
                    {
                        LiveMarketBuyOutcome? liveOutcome = null;
                        if (isLive)
                        {
                            liveOutcome = await _clob.PlaceEntryOrderAsync(
                                tokenId,
                                stake,
                                settings.LiveEntryOrderMode,
                                bidPrice,
                                askPrice,
                                new LiveEntryOrderKey(actions.Entry.TargetCandleTime, tokenId),
                                ct);
                            if (!liveOutcome.IsSuccess)
                            {
                                ReleaseEntryTargetClaim(targetCandleTime);
                                _logger.LogWarning(
                                    "Live entry failed candle {CandleTime} side {Side} trend {Trend} stake ${Stake:F2} token {TokenId} market {MarketId}: {Reason}",
                                    targetCandleTime,
                                    side,
                                    actions.Entry.Trend,
                                    stake,
                                    tokenId,
                                    entryMarket.Id,
                                    liveOutcome.FailureReason ?? "unknown");
                                await TryRecordSkipAsync(
                                    db,
                                    settings,
                                    targetCandleTime,
                                    tradeContextId,
                                    "order_failed",
                                    entryMarket.Id,
                                    liveOutcome.FailureReason,
                                    side: side.ToString(),
                                    trend: actions.Entry.Trend.ToString(),
                                    stakeUsd: stake,
                                    entryFailedToPublish: entryFailedToPublish,
                                    ct: ct);
                            }
                            else
                            {
                                var liveBuy = liveOutcome.Result!;
                                orderId = liveBuy.OrderId;
                                stake = liveBuy.FilledStakeUsd;
                                if (liveBuy.AveragePrice is > 0)
                                {
                                    entryPrice = liveBuy.AveragePrice.Value;
                                }
                                else if (liveBuy.MatchedShares > 0 && stake > 0)
                                {
                                    entryPrice = stake / liveBuy.MatchedShares;
                                }
                            }
                        }
                        else
                        {
                            orderId = $"paper-{Guid.NewGuid():N}";
                            _logger.LogInformation(
                                "Paper fill @ {Price:F4} on token {TokenId} (simulated order {OrderId})",
                                entryPrice,
                                tokenId,
                                orderId);
                        }

                        if (!isLive || liveOutcome is { IsSuccess: true })
                        {
                            double? requestedStakeUsd = null;
                            string? entryWavesJson = null;
                            if (isLive && liveOutcome?.Result is { } liveResult)
                            {
                                requestedStakeUsd = liveResult.RequestedStakeUsd;
                                if (liveResult.EntryWaves is { Count: > 0 } waves)
                                {
                                    entryWavesJson = TradeEntryWavesJson.Serialize(waves);
                                }
                            }

                            var trade = new TradeEntity
                            {
                                CandleTime = actions.Entry.TargetCandleTime,
                                Side = side,
                                Trend = actions.Entry.Trend,
                                Mode = settings.TradingMode,
                                PaperAccountId = tradeContextId,
                                StakeUsd = stake,
                                RequestedStakeUsd = requestedStakeUsd,
                                EntryPrice = entryPrice,
                                Won = null,
                                PnlUsd = null,
                                PolymarketOrderId = orderId,
                                EntryWavesJson = entryWavesJson,
                                MarketId = entryMarket.Id,
                            };

                            db.Trades.Add(trade);
                            tradesToPublish.Add(trade);

                            _logger.LogInformation(
                                "Opened {Mode} trade candle {CandleTime} side {Side} trend {Trend} @ {Price:F4} stake ${Stake:F2} order={OrderId} market={MarketId}",
                                settings.TradingMode,
                                actions.Entry.TargetCandleTime,
                                side,
                                actions.Entry.Trend,
                                entryPrice,
                                stake,
                                orderId,
                                entryMarket.Id);
                        }
                    }
                    }
                }
            }
            }
        }
        else if (intervalSeconds > 0)
        {
            var nextOpenTime = closedCandle.Time + intervalSeconds;
            var skipRecorded = await TryRecordSkipAsync(
                db,
                settings,
                nextOpenTime,
                tradeContextId,
                "no_signal",
                marketId: null,
                ct: ct);

            _logger.LogInformation(
                "No BoS flow entry for next candle {NextCandleTime} (closed {ClosedCandleTime}); skipRecorded={SkipRecorded}",
                nextOpenTime,
                closedCandle.Time,
                skipRecorded);
        }

        if (balanceChanged && paperAccount != null)
        {
            db.PaperAccounts.Update(paperAccount);
        }

        await RecordCandleBalanceSnapshotAsync(
            db,
            settings,
            paperAccount,
            tradeContextId,
            closedCandle.Time,
            workingBalance,
            ct);

        return tradesToPublish;
    }

    private async Task<double> GetWorkingBalanceAsync(
        EngineSettingsEntity settings,
        PaperAccountEntity? paperAccount,
        CancellationToken ct)
    {
        if (settings.TradingMode == TradingMode.Paper)
        {
            return paperAccount?.Balance ?? 0;
        }

        return await _clob.GetCollateralBalanceAsync(ct) ?? 0;
    }

    private void LogTradeClosed(
        TradeEntity trade,
        bool won,
        double pnl,
        double? balanceAfter)
    {
        _logger.LogInformation(
            "Closed {Mode} trade id={TradeId} candle {CandleTime} side {Side} → {Outcome} PnL ${Pnl:F2} stake ${Stake:F2} entry={Entry:F4} balanceAfter={Balance}",
            trade.Mode,
            trade.Id,
            trade.CandleTime,
            trade.Side,
            won ? "won" : "lost",
            pnl,
            trade.StakeUsd,
            trade.EntryPrice,
            balanceAfter?.ToString("F2") ?? "n/a");
    }

    private async Task TriggerRedeemForConditionAsync(string conditionId, long candleTime)
    {
        try
        {
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
                var autoRedeemEnabled = await db.EngineSettings
                    .AsNoTracking()
                    .Select(s => s.AutoRedeemEnabled)
                    .FirstAsync();
                if (!autoRedeemEnabled)
                {
                    _logger.LogDebug(
                        "Post-settlement redeem skipped (auto-redeem disabled) candle {CandleTime} condition {ConditionId}",
                        candleTime,
                        conditionId);
                    return;
                }
            }

            _logger.LogInformation(
                "Scheduling post-settlement redeem for candle {CandleTime} condition {ConditionId} (delay 15s)",
                candleTime,
                conditionId);

            await Task.Delay(TimeSpan.FromSeconds(15));
            _logger.LogInformation(
                "Executing post-settlement redeem for candle {CandleTime} condition {ConditionId}",
                candleTime,
                conditionId);
            var result = await _redeem.TryRedeemConditionAsync(conditionId);
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
                var dataApi = scope.ServiceProvider.GetRequiredService<IPolymarketDataApiService>();
                if (result.Success)
                {
                    await TradeRedeemRecorder.MarkConditionRedeemedAsync(db, conditionId);
                    _logger.LogInformation(
                        "Post-settlement redeem succeeded candle {CandleTime} condition {ConditionId} tx {TxHash}",
                        candleTime,
                        conditionId,
                        result.TransactionHash);
                }
                else
                {
                    _logger.LogWarning(
                        "Post-settlement redeem returned failure candle {CandleTime} condition {ConditionId} error={Error}",
                        candleTime,
                        conditionId,
                        result.Error ?? "unknown");
                }

                var synced = await TradeRedeemRecorder.SyncRedeemedWinsFromDataApiAsync(db, dataApi);
                if (synced > 0)
                {
                    _logger.LogInformation(
                        "Post-settlement: marked {Count} win(s) redeemed via Data API sync candle {CandleTime}",
                        synced,
                        candleTime);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Post-settlement redeem failed for candle {CandleTime} condition {ConditionId}",
                candleTime,
                conditionId);
        }
    }

    private async Task RecordCandleBalanceSnapshotAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        PaperAccountEntity? paperAccount,
        int tradeContextId,
        long closedCandleTimeMs,
        double workingBalanceFallback,
        CancellationToken ct)
    {
        var contextId = settings.TradingMode == TradingMode.Paper ? tradeContextId : 0;
        var balance = settings.TradingMode == TradingMode.Paper
            ? paperAccount?.Balance ?? 0
            : await _clob.GetCollateralBalanceAsync(ct) ?? workingBalanceFallback;

        await BalanceSnapshotRecorder.RecordAsync(
            db,
            contextId,
            closedCandleTimeMs,
            balance,
            settings.TradingMode == TradingMode.Paper ? "Paper" : "Live",
            ct);
    }

    private static object ToTradeEventDto(TradeEntity t) => new
    {
        t.Id,
        t.CandleTime,
        side = t.Side.ToString(),
        trend = t.Trend.ToString(),
        mode = t.Mode.ToString(),
        t.StakeUsd,
        t.EntryPrice,
        t.Won,
        t.PnlUsd,
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

        var fromRest = await _clob.TryGetBuyPriceAsync(outcomeTokenId, ct)
            ?? await _clob.TryGetMidPriceAsync(outcomeTokenId, ct);
        if (IsValidPrice(fromRest))
        {
            return fromRest!.Value;
        }

        for (var attempt = 0; attempt < 8; attempt++)
        {
            await Task.Delay(250, ct);
            fromWs = _marketWs.Prices.GetBuyPrice(outcomeTokenId)
                ?? _marketWs.Prices.GetMid(outcomeTokenId);
            if (IsValidPrice(fromWs))
            {
                return fromWs!.Value;
            }
        }

        _logger.LogWarning(
            "No Polymarket ask for token {TokenId} (market {Yes}/{No}); using 0.5 fallback",
            outcomeTokenId,
            yesTokenId,
            noTokenId);
        return 0.5;
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

        for (var attempt = 0; attempt < 8; attempt++)
        {
            await Task.Delay(250, ct);
            fromWs = _marketWs.Prices.GetOrCreate(outcomeTokenId).MakerBuyPrice
                ?? _marketWs.Prices.GetMid(outcomeTokenId);
            if (IsValidPrice(fromWs))
            {
                return fromWs!.Value;
            }
        }

        _logger.LogWarning(
            "No Polymarket bid for token {TokenId} (market {Yes}/{No}); using 0.5 fallback",
            outcomeTokenId,
            yesTokenId,
            noTokenId);
        return 0.5;
    }

    private async Task<MarketEntity?> ResolveMarketForCandleAsync(
        PolyTraderDbContext db,
        long candleTimeUnix,
        CancellationToken ct)
    {
        var candleStart = DateTimeOffset.FromUnixTimeSeconds(candleTimeUnix).UtcDateTime;

        var fromDb = await db.Markets
            .FirstOrDefaultAsync(
                m => m.WindowStartUtc == candleStart,
                ct);
        if (fromDb != null)
        {
            await _marketWs.SubscribeAsync(fromDb.YesTokenId, fromDb.NoTokenId, ct);
            return fromDb;
        }

        var discovered = await _gamma.DiscoverMarketByWindowStartAsync(candleTimeUnix, ct);
        if (discovered == null)
        {
            var windows = await _gamma.DiscoverBtc5mWindowsAsync(ct);
            if (windows.Current?.WindowStartUtc == candleStart)
            {
                discovered = windows.Current;
            }
            else if (windows.NextScheduled?.WindowStartUtc == candleStart)
            {
                discovered = windows.NextScheduled;
            }
        }

        if (discovered == null)
        {
            return null;
        }

        var market = await UpsertMarketAsync(db, discovered, ct);
        await _marketWs.SubscribeAsync(market.YesTokenId, market.NoTokenId, ct);
        return market;
    }

    private async Task<MarketEntity> UpsertMarketAsync(
        PolyTraderDbContext db,
        MarketEntity discovered,
        CancellationToken ct)
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
        // Assign Id before Trades/SkippedBets reference MarketId (FK constraint).
        await db.SaveChangesAsync(ct);
        return discovered;
    }

    private static List<ChartCandle> TrimBufferThroughClosedCandle(
        IReadOnlyList<ChartCandle> buffer,
        long closedCandleTime)
    {
        var closedIndex = -1;
        for (var i = buffer.Count - 1; i >= 0; i--)
        {
            if (buffer[i].Time == closedCandleTime)
            {
                closedIndex = i;
                break;
            }
        }

        if (closedIndex < 0)
        {
            return [];
        }

        return buffer.Take(closedIndex + 1).ToList();
    }

    private static bool IsEntryErrorSkipReason(string skipReason) =>
        skipReason is "order_failed" or "insufficient_balance" or "balance_unavailable" or "no_market" or "clob_min_order_size";

    private async Task<bool> TryRecordSkipAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        long candleTime,
        int? paperAccountId,
        string skipReason,
        int? marketId,
        string? detail = null,
        string? side = null,
        string? trend = null,
        double? stakeUsd = null,
        List<EntryFailedEvent>? entryFailedToPublish = null,
        CancellationToken ct = default)
    {
        var contextId = paperAccountId ?? 0;
        if (settings.TradingMode == TradingMode.Paper && paperAccountId is null)
        {
            _logger.LogWarning(
                "Skip not recorded for candle {CandleTime}: paper mode without active account ({Reason})",
                candleTime,
                skipReason);
            return false;
        }

        var resolvedMarketId = marketId;
        if (resolvedMarketId is null or 0)
        {
            var market = await ResolveMarketForCandleAsync(db, candleTime, ct);
            if (market == null)
            {
                if (_activeMarket is { Id: > 0 })
                {
                    resolvedMarketId = _activeMarket.Id;
                }
                else
                {
                    _logger.LogWarning(
                        "Skip not recorded for candle {CandleTime}: no market resolved ({Reason})",
                        candleTime,
                        skipReason);
                    return false;
                }
            }
            else
            {
                _activeMarket = market;
                resolvedMarketId = market.Id;
            }
        }

        if (resolvedMarketId is null or 0)
        {
            _logger.LogWarning(
                "Skip not recorded for candle {CandleTime}: market id missing ({Reason})",
                candleTime,
                skipReason);
            return false;
        }

        var hasTrade = await db.Trades.AnyAsync(
            t => t.CandleTime == candleTime
                && t.Mode == settings.TradingMode
                && t.PaperAccountId == contextId,
            ct);
        if (hasTrade) return false;

        var hasSkip = await db.SkippedBets.AnyAsync(
            s => s.CandleTime == candleTime
                && s.Mode == settings.TradingMode
                && s.PaperAccountId == contextId
                && s.MarketId == resolvedMarketId,
            ct);
        if (hasSkip) return false;

        db.SkippedBets.Add(new SkippedBetEntity
        {
            CandleTime = candleTime,
            MarketId = resolvedMarketId.Value,
            Mode = settings.TradingMode,
            PaperAccountId = contextId,
            SkipReason = skipReason,
        });

        if (IsEntryErrorSkipReason(skipReason))
        {
            _logger.LogWarning(
                "Recorded entry error candle {CandleTime} reason={Reason} detail={Detail} mode={Mode} account={AccountId} market={MarketId}",
                candleTime,
                skipReason,
                detail ?? "(none)",
                settings.TradingMode,
                contextId,
                resolvedMarketId.Value);

            var marketMeta = await db.Markets.AsNoTracking()
                .Where(m => m.Id == resolvedMarketId.Value)
                .Select(m => new { m.Title, m.Slug })
                .FirstOrDefaultAsync(ct);

            entryFailedToPublish?.Add(new EntryFailedEvent(
                candleTime,
                settings.TradingMode.ToString(),
                skipReason,
                detail,
                marketMeta?.Title,
                marketMeta?.Slug,
                side,
                trend,
                stakeUsd));
        }
        else
        {
            _logger.LogInformation(
                "Recorded skip candle {CandleTime} reason={Reason} mode={Mode} account={AccountId} market={MarketId}",
                candleTime,
                skipReason,
                settings.TradingMode,
                contextId,
                resolvedMarketId.Value);
        }

        return true;
    }

    private bool TryClaimCloseEvaluation(long closedCandleTime)
    {
        lock (_entryDedupLock)
        {
            return _evaluatedCloseTimes.Add(closedCandleTime);
        }
    }

    private bool TryClaimEntryTarget(long targetCandleTime)
    {
        lock (_entryDedupLock)
        {
            return _claimedEntryTargets.Add(targetCandleTime);
        }
    }

    private void ReleaseEntryTargetClaim(long targetCandleTime)
    {
        lock (_entryDedupLock)
        {
            _claimedEntryTargets.Remove(targetCandleTime);
        }
    }

    private void LogCandleDecision(
        string source,
        long closedCandleTime,
        long nextCandleTime,
        CandleCloseStrategyResult actions)
    {
        var entry = actions.Entry == null
            ? "none"
            : $"{actions.Entry.Trend}@{actions.Entry.TargetCandleTime}";
        var settlement = actions.Settlement == null
            ? "none"
            : $"{(actions.Settlement.Won ? "won" : "lost")}@{actions.Settlement.CandleTime}";
        _logger.LogInformation(
            "Candle decision [{Source}] closed={ClosedTime} next={NextTime} entry={Entry} settlement={Settlement}",
            source,
            closedCandleTime,
            nextCandleTime,
            entry,
            settlement);
    }



    /// <summary>
    /// After restart: mark the in-progress candle as skipped (missed entry while engine was down)
    /// and settle any open trades left from before shutdown.
    /// </summary>
    private async Task RecoverOnStartupAsync(CancellationToken ct)
    {
        var candles = _binance.Candles;
        if (candles.Count == 0)
        {
            return;
        }

        var latest = candles[^1];
        _lastSeenLatestCandleTime = latest.Time;

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
        var settings = await db.EngineSettings.FirstOrDefaultAsync(ct) ?? new EngineSettingsEntity();

        var tradesToPublish = new List<TradeEntity>();
        var balanceUpdates = new HashSet<int>();

        var inProgressSkips = scope.ServiceProvider.GetRequiredService<InProgressWindowSkipService>();
        await inProgressSkips.TryRecordEngineStoppedForInProgressWindowAsync(settings, ct);

        var openTrades = await db.Trades
            .Include(t => t.Market)
            .Where(t => t.Won == null)
            .OrderBy(t => t.CandleTime)
            .ToListAsync(ct);

        _logger.LogInformation(
            "Startup recovery: {OpenCount} open trade(s), engine running={Running} mode={Mode}",
            openTrades.Count,
            settings.IsRunning,
            settings.TradingMode);

        foreach (var trade in openTrades)
        {
            if (trade.CandleTime >= latest.Time)
            {
                continue;
            }

            var settled = await TrySettleOpenTradeOnStartupAsync(
                db,
                settings,
                trade,
                candles,
                latest.Time,
                ct);

            if (!settled)
            {
                continue;
            }

            tradesToPublish.Add(trade);
            if (trade.Mode == TradingMode.Paper && trade.PaperAccountId > 0)
            {
                balanceUpdates.Add(trade.PaperAccountId);
            }
        }

        if (tradesToPublish.Count > 0 || db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync(ct);
        }

        await PublishTradesAndBalanceAsync(db, tradesToPublish, null, ct);

        foreach (var paperId in balanceUpdates)
        {
            var account = await db.PaperAccounts.FindAsync([paperId], ct);
            if (account != null)
            {
                await _publisher.PublishBalanceUpdatedAsync(account.Balance, account.Id, ct);
            }
        }
    }

    private async Task<bool> TrySettleOpenTradeOnStartupAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        TradeEntity trade,
        IReadOnlyList<ChartCandle> candles,
        long formingCandleTime,
        CancellationToken ct)
    {
        if (trade.Won != null)
        {
            return false;
        }

        if (trade.Market == null)
        {
            if (trade.MarketId is > 0)
            {
                await db.Entry(trade).Reference(t => t.Market).LoadAsync(ct);
            }

            if (trade.Market == null)
            {
                var resolved = await ResolveMarketForCandleAsync(db, trade.CandleTime, ct);
                if (resolved != null)
                {
                    trade.Market = resolved;
                    trade.MarketId = resolved.Id;
                }
            }
        }

        var closedCandle = await ResolveClosedCandleForTradeAsync(db, trade.CandleTime, candles, formingCandleTime, ct);
        bool? won = null;

        if (trade.Mode == TradingMode.Paper)
        {
            if (closedCandle == null)
            {
                return false;
            }

            won = TrendBetStrategySimulator.IsBetWon(trade.Trend, closedCandle);
        }
        else
        {
            won = await TryResolveLiveTradeOutcomeAsync(trade, closedCandle, ct);
        }

        if (won == null)
        {
            return false;
        }

        PaperAccountEntity? paperAccount = null;
        if (trade.Mode == TradingMode.Paper && trade.PaperAccountId > 0)
        {
            paperAccount = await db.PaperAccounts
                .FirstOrDefaultAsync(a => a.Id == trade.PaperAccountId && !a.IsArchived, ct);
            if (paperAccount == null)
            {
                _logger.LogWarning(
                    "Startup settlement skipped: paper account {Id} missing for trade {TradeId}",
                    trade.PaperAccountId,
                    trade.Id);
                return false;
            }
        }

        var commission = trade.Mode == TradingMode.Live
            ? LiveTradeCommissionPercent
            : settings.CommissionPercent;
        trade.Won = won.Value;
        var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
            won.Value,
            trade.StakeUsd,
            commission,
            trade.EntryPrice);
        trade.PnlUsd = pnl;

        if (paperAccount != null)
        {
            paperAccount.Balance += pnl;
            paperAccount.UpdatedAt = DateTime.UtcNow;
            db.PaperAccounts.Update(paperAccount);
            await BalanceSnapshotRecorder.RecordAsync(
                db,
                paperAccount.Id,
                trade.CandleTime,
                paperAccount.Balance,
                "Paper",
                ct);
        }

        db.Trades.Update(trade);
        LogTradeClosed(trade, won.Value, pnl, paperAccount?.Balance);
        _logger.LogInformation(
            "Startup: settled {Mode} trade {TradeId} candle {CandleTime}",
            trade.Mode,
            trade.Id,
            trade.CandleTime);

        if (trade.Mode == TradingMode.Live
            && won.Value
            && settings.AutoRedeemEnabled
            && !string.IsNullOrWhiteSpace(trade.Market?.ConditionId))
        {
            _ = TriggerRedeemForConditionAsync(trade.Market.ConditionId, trade.CandleTime);
        }

        return true;
    }

    private Task<bool?> TryResolveLiveTradeOutcomeAsync(
        TradeEntity trade,
        ChartCandle? closedCandle,
        CancellationToken ct) =>
        _liveSettlement.TryResolveOutcomeAsync(trade, closedCandle, ct);

    private static async Task<ChartCandle?> ResolveClosedCandleForTradeAsync(
        PolyTraderDbContext db,
        long candleTime,
        IReadOnlyList<ChartCandle> candles,
        long formingCandleTime,
        CancellationToken ct)
    {
        if (candleTime >= formingCandleTime)
        {
            return null;
        }

        var fromBuffer = candles.FirstOrDefault(c => c.Time == candleTime);
        if (fromBuffer != null)
        {
            return fromBuffer;
        }

        var snap = await db.CandleSnapshots.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Time == candleTime, ct);
        if (snap == null)
        {
            return null;
        }

        return new ChartCandle
        {
            Time = snap.Time,
            Open = snap.Open,
            High = snap.High,
            Low = snap.Low,
            Close = snap.Close,
        };
    }

    private async Task RefreshMarketAsync(CancellationToken ct)

    {

        var discovered = await _gamma.DiscoverActiveBtc5mMarketAsync(ct);

        if (discovered == null)
        {
            _logger.LogDebug("Market refresh: no active BTC 5m market from Gamma");
            return;
        }



        await using var scope = _scopeFactory.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();



        var existing = await db.Markets

            .FirstOrDefaultAsync(m => m.ConditionId == discovered.ConditionId, ct);



        if (existing != null)

        {

            existing.YesTokenId = discovered.YesTokenId;

            existing.NoTokenId = discovered.NoTokenId;

            existing.WindowStartUtc = discovered.WindowStartUtc;

            existing.WindowEndUtc = discovered.WindowEndUtc;

            existing.IsActive = true;

            existing.UpdatedAt = DateTime.UtcNow;

            _activeMarket = existing;

        }

        else

        {

            foreach (var m in await db.Markets.Where(x => x.IsActive).ToListAsync(ct))

            {

                m.IsActive = false;

            }



            db.Markets.Add(discovered);

            await db.SaveChangesAsync(ct);

            _activeMarket = discovered;

        }



        await _marketWs.SubscribeAsync(discovered.YesTokenId, discovered.NoTokenId, ct);

        _logger.LogInformation(
            "Active market updated condition={ConditionId} slug={Slug} window={Start}–{End}",
            discovered.ConditionId,
            discovered.Slug,
            discovered.WindowStartUtc,
            discovered.WindowEndUtc);

        await _publisher.PublishMarketWindowUpdatedAsync(_activeMarket);

    }



    public override async Task StopAsync(CancellationToken cancellationToken)

    {
        _logger.LogInformation("Trading engine stopping");

        _binance.KlineClosed -= OnKlineClosed;
        _binance.CandlesUpdated -= OnCandlesUpdated;

        await _binance.StopAsync();

        await _marketWs.StopAsync();

        await base.StopAsync(cancellationToken);

    }

}

