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

    private readonly ITradingEventPublisher _publisher;

    private readonly PolyTraderOptions _options;

    private readonly ILogger<TradingEngineHostedService> _logger;

    private MarketEntity? _activeMarket;



    public TradingEngineHostedService(

        IServiceScopeFactory scopeFactory,

        IBinanceMarketService binance,

        IPolymarketGammaService gamma,

        IPolymarketMarketWebSocket marketWs,

        IPolymarketClobService clob,

        ITradingEventPublisher publisher,

        IOptions<PolyTraderOptions> options,

        ILogger<TradingEngineHostedService> logger)

    {

        _scopeFactory = scopeFactory;

        _binance = binance;

        _gamma = gamma;

        _marketWs = marketWs;

        _clob = clob;

        _publisher = publisher;

        _options = options.Value;

        _logger = logger;

    }



    protected override async Task ExecuteAsync(CancellationToken stoppingToken)

    {

        _binance.KlineClosed += OnKlineClosed;

        _marketWs.MarketResolved += async (_, _) => await RefreshMarketAsync(stoppingToken);



        await _binance.StartAsync(stoppingToken);

        await RefreshMarketAsync(stoppingToken);



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



    private async Task HandleKlineClosedAsync(BinanceKlineClosedEventArgs e)

    {

        await using var scope = _scopeFactory.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();

        var settings = await db.EngineSettings.FirstOrDefaultAsync() ?? new EngineSettingsEntity();

        if (!settings.IsRunning)

        {

            return;

        }



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



        var isPaper = settings.TradingMode == TradingMode.Paper;

        PaperAccountEntity? paperAccount = null;

        if (isPaper)

        {

            if (settings.ActivePaperAccountId is not int paperId)

            {

                _logger.LogWarning("Paper mode active but no paper account selected; skipping candle");

                await db.SaveChangesAsync();

                return;

            }



            paperAccount = await db.PaperAccounts.FirstOrDefaultAsync(a => a.Id == paperId && !a.IsArchived);

            if (paperAccount == null)

            {

                _logger.LogWarning("Active paper account {Id} missing or archived; skipping candle", paperId);

                await db.SaveChangesAsync();

                return;

            }

        }



        var tradeContextId = paperAccount?.Id ?? 0;

        var workingBalance = paperAccount?.Balance ?? 0;



        var strategyParams = new TrendBetStrategyParams

        {

            StartBalance = workingBalance,

            BetStake = settings.BetStakeUsd,

            CommissionPercent = settings.CommissionPercent

        };



        var defaultInterval = CandleIntervalHelper.ParseBinanceIntervalSeconds(_options.BinanceInterval);

        var intervalSeconds = CandleIntervalHelper.InferIntervalSeconds(e.Buffer, defaultInterval);



        var actions = TrendBetStrategySimulator.ProcessCandleClose(

            e.Candle,

            e.Buffer,

            intervalSeconds,

            strategyParams);



        if (actions == null)

        {

            await db.SaveChangesAsync();

            return;

        }



        var balanceChanged = false;



        if (actions.Settlement != null)

        {

            var openTrade = await db.Trades.FirstOrDefaultAsync(t =>

                t.CandleTime == actions.Settlement.CandleTime

                && t.Mode == settings.TradingMode

                && t.PaperAccountId == tradeContextId

                && t.Won == null);



            if (openTrade != null)

            {

                openTrade.Won = actions.Settlement.Won;

                openTrade.PnlUsd = actions.Settlement.Pnl;



                if (isPaper && paperAccount != null)

                {

                    paperAccount.Balance += actions.Settlement.Pnl;

                    paperAccount.UpdatedAt = DateTime.UtcNow;

                    balanceChanged = true;

                }



                db.Trades.Update(openTrade);

                await _publisher.PublishTradePlacedAsync(openTrade, CancellationToken.None);

            }

        }



        if (actions.Entry != null)

        {

            var entryExists = await db.Trades.AnyAsync(t =>

                t.CandleTime == actions.Entry.TargetCandleTime

                && t.Mode == settings.TradingMode

                && t.PaperAccountId == tradeContextId);



            if (!entryExists)

            {

                if (_activeMarket == null)

                {

                    await RefreshMarketAsync(CancellationToken.None);

                }



                if (_activeMarket == null)

                {

                    _logger.LogWarning("No active Polymarket market; skipping entry for {CandleTime}",

                        actions.Entry.TargetCandleTime);

                }

                else

                {

                    var side = actions.Entry.Trend == MarketTrend.Long ? TradeSide.Up : TradeSide.Down;

                    var tokenId = side == TradeSide.Up

                        ? _activeMarket.YesTokenId

                        : _activeMarket.NoTokenId;

                    var entryPrice = _marketWs.Prices.GetBuyPrice(tokenId)

                        ?? _marketWs.Prices.GetMid(tokenId)

                        ?? 0.5;



                    if (entryPrice is <= 0 or > 1)

                    {

                        _logger.LogWarning(

                            "Unusual entry price {Price} for token {TokenId}; using 0.5 fallback",

                            entryPrice,

                            tokenId);

                        entryPrice = 0.5;

                    }



                    string? orderId = null;

                    if (settings.TradingMode == TradingMode.Live)

                    {

                        orderId = await _clob.PlaceMarketOrderAsync(tokenId, settings.BetStakeUsd);

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

                            StakeUsd = settings.BetStakeUsd,

                            EntryPrice = entryPrice,

                            Won = null,

                            PnlUsd = null,

                            PolymarketOrderId = orderId,

                            MarketId = _activeMarket.Id

                        };



                        db.Trades.Add(trade);

                        await _publisher.PublishTradePlacedAsync(trade, CancellationToken.None);



                        _logger.LogInformation(

                            "Opened {Mode} trade for candle {CandleTime} trend {Trend} @ {Price:F4}",

                            settings.TradingMode,

                            actions.Entry.TargetCandleTime,

                            actions.Entry.Trend,

                            entryPrice);

                    }

                }

            }

        }



        if (balanceChanged && paperAccount != null)

        {

            db.PaperAccounts.Update(paperAccount);

            db.BalanceSnapshots.Add(new BalanceSnapshotEntity

            {

                CashBalance = paperAccount.Balance,

                Equity = paperAccount.Balance,

                Source = "Paper",

                PaperAccountId = paperAccount.Id

            });

            await _publisher.PublishBalanceUpdatedAsync(

                paperAccount.Balance,

                paperAccount.Id,

                CancellationToken.None);

        }



        await db.SaveChangesAsync();

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

        await _binance.StopAsync();

        await _marketWs.StopAsync();

        await base.StopAsync(cancellationToken);

    }

}

