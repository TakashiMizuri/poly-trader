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

    private readonly IServiceScopeFactory _scopeFactory;

    private readonly IBinanceMarketService _binance;

    private readonly IPolymarketGammaService _gamma;

    private readonly IPolymarketMarketWebSocket _marketWs;

    private readonly IPolymarketClobService _clob;

    private readonly IPolymarketDataApiService _dataApi;

    private readonly ITradingEventPublisher _publisher;

    private readonly PolyTraderOptions _options;

    private readonly ILogger<TradingEngineHostedService> _logger;

    private MarketEntity? _activeMarket;

    private long? _lastSeenLatestCandleTime;



    public TradingEngineHostedService(

        IServiceScopeFactory scopeFactory,

        IBinanceMarketService binance,

        IPolymarketGammaService gamma,

        IPolymarketMarketWebSocket marketWs,

        IPolymarketClobService clob,

        IPolymarketDataApiService dataApi,

        ITradingEventPublisher publisher,

        IOptions<PolyTraderOptions> options,

        ILogger<TradingEngineHostedService> logger)

    {

        _scopeFactory = scopeFactory;

        _binance = binance;

        _gamma = gamma;

        _marketWs = marketWs;

        _clob = clob;

        _dataApi = dataApi;

        _publisher = publisher;

        _options = options.Value;

        _logger = logger;

    }



    protected override async Task ExecuteAsync(CancellationToken stoppingToken)

    {

        _binance.KlineClosed += OnKlineClosed;
        _binance.CandlesUpdated += OnCandlesUpdated;

        _marketWs.MarketResolved += async (_, _) => await RefreshMarketAsync(stoppingToken);



        await _binance.StartAsync(stoppingToken);

        await RefreshMarketAsync(stoppingToken);

        await RecoverOnStartupAsync(stoppingToken);



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

        var strategyParams = settings.ToStrategyParams(paperAccount?.Balance ?? 0);

        var nextBar = candles.FirstOrDefault(c => c.Time == latest.Time);

        var actions = TrendBetStrategySimulator.ProcessCandleClose(

            closedCandle,

            closedBuffer,

            intervalSeconds,

            strategyParams,

            nextBar);

        if (actions == null) return;

        LogCandleDecision("bar_open_backup", closedCandle.Time, latest.Time, actions);

        var tradesToPublish = await ApplyStrategyActionsAsync(
            db,
            settings,
            tradeContextId,
            paperAccount,
            closedCandle,
            intervalSeconds,
            actions);

        await db.SaveChangesAsync();

        foreach (var trade in tradesToPublish)
        {
            await db.Entry(trade).Reference(t => t.Market).LoadAsync();
            await _publisher.PublishTradePlacedAsync(ToTradeEventDto(trade), CancellationToken.None);
        }

        if (paperAccount != null && tradesToPublish.Exists(t => t.Won != null))
        {
            await _publisher.PublishBalanceUpdatedAsync(
                paperAccount.Balance,
                paperAccount.Id,
                CancellationToken.None);
        }
    }



    private async Task HandleKlineClosedAsync(BinanceKlineClosedEventArgs e)

    {

        await using var scope = _scopeFactory.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();

        var settings = await db.EngineSettings.FirstOrDefaultAsync() ?? new EngineSettingsEntity();

        var isPaper = settings.TradingMode == TradingMode.Paper;
        var tradeContextId = 0;
        if (isPaper)
        {
            if (settings.ActivePaperAccountId is not int paperId)
            {
                await TryRecordSkipAsync(db, settings, e.Candle.Time, null, "engine_stopped", marketId: null);
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



        var workingBalance = paperAccount?.Balance ?? 0;

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

        LogCandleDecision("kline_closed", e.Candle.Time, nextOpenTime, actions);

        var tradesToPublish = await ApplyStrategyActionsAsync(
            db,
            settings,
            tradeContextId,
            paperAccount,
            e.Candle,
            intervalSeconds,
            actions);

        await db.SaveChangesAsync();

        foreach (var trade in tradesToPublish)
        {
            await db.Entry(trade).Reference(t => t.Market).LoadAsync();
            await _publisher.PublishTradePlacedAsync(ToTradeEventDto(trade), CancellationToken.None);
        }

        if (paperAccount != null && tradesToPublish.Exists(t => t.Won != null))
        {
            await _publisher.PublishBalanceUpdatedAsync(
                paperAccount.Balance,
                paperAccount.Id,
                CancellationToken.None);
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
        CancellationToken ct = default)
    {
        var isPaper = settings.TradingMode == TradingMode.Paper;
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
                openTrade.Won = actions.Settlement.Won;
                var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
                    actions.Settlement.Won,
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
            }
        }

        if (actions.Entry != null)
        {
            var entryExists = await db.Trades.AnyAsync(t =>
                    t.CandleTime == actions.Entry.TargetCandleTime
                    && t.Mode == settings.TradingMode
                    && t.PaperAccountId == tradeContextId,
                ct);

            if (!entryExists)
            {
                var entryMarket = await ResolveMarketForCandleAsync(
                    db,
                    actions.Entry.TargetCandleTime,
                    ct);

                if (entryMarket == null)
                {
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
                        ct);
                }
                else
                {
                    _activeMarket = entryMarket;

                    var side = actions.Entry.Trend == MarketTrend.Long ? TradeSide.Up : TradeSide.Down;
                    var tokenId = side == TradeSide.Up
                        ? entryMarket.YesTokenId
                        : entryMarket.NoTokenId;
                    var entryPrice = await ResolveEntryPriceAsync(
                        entryMarket.YesTokenId,
                        entryMarket.NoTokenId,
                        tokenId,
                        ct);

                    string? orderId = null;
                    var balanceAtOpen = paperAccount?.Balance ?? 0;
                    var stakeParams = settings.ToStrategyParams(balanceAtOpen);
                    var stake = BetStakeResolver.ResolveForBalance(balanceAtOpen, stakeParams)
                        ?? (settings.BetStakeMode == BetStakeMode.Fixed
                            ? settings.BetStakeUsd
                            : BetStakeResolver.RequestedStake(balanceAtOpen, stakeParams));

                    if (settings.TradingMode == TradingMode.Live)
                    {
                        orderId = await _clob.PlaceMarketOrderAsync(tokenId, stake);
                        if (orderId == null)
                        {
                            _logger.LogWarning("Live order failed; trade not recorded");
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

                    if (settings.TradingMode != TradingMode.Live || orderId != null)
                    {
                        var trade = new TradeEntity
                        {
                            CandleTime = actions.Entry.TargetCandleTime,
                            Side = side,
                            Trend = actions.Entry.Trend,
                            Mode = settings.TradingMode,
                            PaperAccountId = tradeContextId,
                            StakeUsd = stake,
                            EntryPrice = entryPrice,
                            Won = null,
                            PnlUsd = null,
                            PolymarketOrderId = orderId,
                            MarketId = entryMarket.Id,
                        };

                        db.Trades.Add(trade);
                        tradesToPublish.Add(trade);

                        _logger.LogInformation(
                            "Opened {Mode} trade for candle {CandleTime} trend {Trend} @ {Price:F4} stake ${Stake:F2}",
                            settings.TradingMode,
                            actions.Entry.TargetCandleTime,
                            actions.Entry.Trend,
                            entryPrice,
                            stake);
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
                ct);

            _logger.LogInformation(
                "No BoS flow entry for next candle {NextCandleTime} (closed {ClosedCandleTime}); skipRecorded={SkipRecorded}",
                nextOpenTime,
                closedCandle.Time,
                skipRecorded);
        }

        if (balanceChanged && paperAccount != null)
        {
            db.PaperAccounts.Update(paperAccount);
            db.BalanceSnapshots.Add(new BalanceSnapshotEntity
            {
                CashBalance = paperAccount.Balance,
                Equity = paperAccount.Balance,
                Source = "Paper",
                PaperAccountId = paperAccount.Id,
            });
        }

        return tradesToPublish;
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

    private async Task<double> ResolveEntryPriceAsync(
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
            "No Polymarket price for token {TokenId} (market {Yes}/{No}); using 0.5 fallback",
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

    private async Task<bool> TryRecordSkipAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        long candleTime,
        int? paperAccountId,
        string skipReason,
        int? marketId,
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
        return true;
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

        await TryRecordMidCandleStartupSkipAsync(db, settings, latest.Time, ct);

        var openTrades = await db.Trades
            .Include(t => t.Market)
            .Where(t => t.Won == null)
            .OrderBy(t => t.CandleTime)
            .ToListAsync(ct);

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

        foreach (var trade in tradesToPublish)
        {
            if (trade.Market == null)
            {
                await db.Entry(trade).Reference(t => t.Market).LoadAsync(ct);
            }

            await _publisher.PublishTradePlacedAsync(ToTradeEventDto(trade), ct);
        }

        foreach (var paperId in balanceUpdates)
        {
            var account = await db.PaperAccounts.FindAsync([paperId], ct);
            if (account != null)
            {
                await _publisher.PublishBalanceUpdatedAsync(account.Balance, account.Id, ct);
            }
        }
    }

    private async Task TryRecordMidCandleStartupSkipAsync(
        PolyTraderDbContext db,
        EngineSettingsEntity settings,
        long currentCandleTime,
        CancellationToken ct)
    {
        var isPaper = settings.TradingMode == TradingMode.Paper;
        int? paperAccountId = null;
        if (isPaper)
        {
            if (settings.ActivePaperAccountId is not int id)
            {
                return;
            }

            paperAccountId = id;
        }

        var recorded = await TryRecordSkipAsync(
            db,
            settings,
            currentCandleTime,
            paperAccountId,
            "engine_stopped",
            marketId: null,
            ct);

        if (recorded)
        {
            await db.SaveChangesAsync(ct);
            _logger.LogInformation(
                "Startup: recorded engine_stopped skip for in-progress candle {CandleTime}",
                currentCandleTime);
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

        var commission = settings.CommissionPercent;
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
            db.BalanceSnapshots.Add(new BalanceSnapshotEntity
            {
                CashBalance = paperAccount.Balance,
                Equity = paperAccount.Balance,
                Source = "Paper",
                PaperAccountId = paperAccount.Id,
            });
        }

        db.Trades.Update(trade);
        _logger.LogInformation(
            "Startup: settled {Mode} trade {TradeId} candle {CandleTime} → {Outcome}",
            trade.Mode,
            trade.Id,
            trade.CandleTime,
            won.Value ? "won" : "lost");

        return true;
    }

    private async Task<bool?> TryResolveLiveTradeOutcomeAsync(
        TradeEntity trade,
        ChartCandle? closedCandle,
        CancellationToken ct)
    {
        var conditionId = trade.Market?.ConditionId;
        if (!string.IsNullOrWhiteSpace(conditionId))
        {
            var winningSide = await _gamma.TryGetResolvedWinningSideAsync(conditionId, ct);
            if (winningSide != null)
            {
                return trade.Side == winningSide.Value;
            }
        }

        var wallet = _dataApi.ResolveWalletAddress();
        if (!string.IsNullOrWhiteSpace(wallet) && trade.Market != null)
        {
            var tokenId = trade.Side == TradeSide.Up
                ? trade.Market.YesTokenId
                : trade.Market.NoTokenId;
            if (!string.IsNullOrWhiteSpace(tokenId))
            {
                var fromPosition = await _dataApi.TryInferOutcomeFromPositionAsync(wallet, tokenId, ct);
                if (fromPosition != null)
                {
                    return fromPosition.Value;
                }
            }
        }

        if (closedCandle != null)
        {
            _logger.LogWarning(
                "Live trade {TradeId} candle {CandleTime}: Polymarket resolution unavailable; using Binance OHLC",
                trade.Id,
                trade.CandleTime);
            return TrendBetStrategySimulator.IsBetWon(trade.Trend, closedCandle);
        }

        return null;
    }

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

        if (discovered == null) return;



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

        await _publisher.PublishMarketWindowUpdatedAsync(_activeMarket);

    }



    public override async Task StopAsync(CancellationToken cancellationToken)

    {

        _binance.KlineClosed -= OnKlineClosed;
        _binance.CandlesUpdated -= OnCandlesUpdated;

        await _binance.StopAsync();

        await _marketWs.StopAsync();

        await base.StopAsync(cancellationToken);

    }

}

