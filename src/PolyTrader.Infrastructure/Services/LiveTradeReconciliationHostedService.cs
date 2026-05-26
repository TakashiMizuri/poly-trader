using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed class LiveTradeReconciliationHostedService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(3);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IPolymarketClobService _clob;
    private readonly ILogger<LiveTradeReconciliationHostedService> _logger;

    public LiveTradeReconciliationHostedService(
        IServiceScopeFactory scopeFactory,
        IPolymarketClobService clob,
        ILogger<LiveTradeReconciliationHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _clob = clob;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunOnceAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(Interval, stoppingToken);
            await RunOnceAsync(stoppingToken);
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        if (!_clob.IsConfigured)
        {
            return;
        }

        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
            var reconcile = scope.ServiceProvider.GetRequiredService<LiveTradeReconciliationService>();
            var result = await reconcile.ReconcileAsync(db, ct);

            if (result.OutcomesCorrected > 0
                || result.RedeemedAtSynced > 0
                || result.SettledFromOpen > 0)
            {
                _logger.LogInformation(
                    "Live trade reconcile: checked={Checked} corrected={Corrected} redeemedAt={Redeemed} settledOpen={Open}",
                    result.TradesChecked,
                    result.OutcomesCorrected,
                    result.RedeemedAtSynced,
                    result.SettledFromOpen);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Live trade reconciliation failed");
        }
    }
}
