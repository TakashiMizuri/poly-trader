using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed class PolymarketRedeemHostedService : BackgroundService
{
    /// <summary>Background redeem scan interval (Data API + optional on-chain txs).</summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IPolymarketRedeemService _redeem;
    private readonly IPolymarketClobService _clob;
    private readonly ILogger<PolymarketRedeemHostedService> _logger;

    public PolymarketRedeemHostedService(
        IServiceScopeFactory scopeFactory,
        IPolymarketRedeemService redeem,
        IPolymarketClobService clob,
        ILogger<PolymarketRedeemHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _redeem = redeem;
        _clob = clob;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Redeem background poll every {IntervalSeconds:F0}s (Data API redeemable scan)",
            Interval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (_clob.IsConfigured)
                {
                    await using var scope = _scopeFactory.CreateAsyncScope();
                    var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
                    var autoRedeemEnabled = await db.EngineSettings
                        .AsNoTracking()
                        .Select(s => s.AutoRedeemEnabled)
                        .FirstAsync(stoppingToken);

                    PolymarketRedeemBatchResult batch = new(0, 0, 0, [], []);
                    if (!autoRedeemEnabled)
                    {
                        _logger.LogDebug("Redeem poll skipped: auto-redeem disabled in settings");
                    }
                    else
                    {
                        _logger.LogDebug("Redeem poll: scanning redeemable positions");
                        batch = await _redeem.TryRedeemAllRedeemableAsync(stoppingToken);
                        if (batch.RedeemableFound > 0 || batch.RedeemAttempted > 0)
                        {
                            _logger.LogInformation(
                                "Redeem poll complete: redeemable={Redeemable} attempted={Attempted} succeeded={Succeeded}",
                                batch.RedeemableFound,
                                batch.RedeemAttempted,
                                batch.RedeemSucceeded);
                        }

                        if (batch.RedeemSucceeded > 0)
                        {
                            foreach (var conditionId in batch.RedeemedConditionIds)
                            {
                                await TradeRedeemRecorder.MarkConditionRedeemedAsync(
                                    db,
                                    conditionId,
                                    stoppingToken);
                            }

                            var usd = await _clob.GetCollateralBalanceAsync(stoppingToken);
                            if (usd is > 0)
                            {
                                db.BalanceSnapshots.Add(new Entities.BalanceSnapshotEntity
                                {
                                    CashBalance = usd.Value,
                                    Equity = usd.Value,
                                    Source = "Live",
                                    PaperAccountId = 0,
                                });
                                await db.SaveChangesAsync(stoppingToken);
                                _logger.LogInformation(
                                    "Recorded live balance snapshot after redeem: ${Balance:F2}",
                                    usd.Value);
                            }
                        }
                    }

                    var dataApi = scope.ServiceProvider.GetRequiredService<IPolymarketDataApiService>();
                    var synced = await TradeRedeemRecorder.SyncRedeemedWinsFromDataApiAsync(
                        db,
                        dataApi,
                        stoppingToken);
                    if (synced > 0)
                    {
                        _logger.LogInformation(
                            "Marked {Count} live win(s) as redeemed (Data API sync)",
                            synced);
                    }
                }
                else
                {
                    _logger.LogDebug("Redeem poll skipped: CLOB not configured");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Redeem poll failed");
            }

            await Task.Delay(Interval, stoppingToken);
        }
    }
}
