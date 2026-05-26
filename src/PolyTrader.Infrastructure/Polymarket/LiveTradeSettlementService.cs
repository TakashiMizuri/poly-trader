using Microsoft.Extensions.Logging;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class LiveTradeSettlementService : ILiveTradeSettlementService
{
    private readonly LiveTradeOutcomeResolver _resolver;
    private readonly ILogger<LiveTradeSettlementService> _logger;

    public LiveTradeSettlementService(
        LiveTradeOutcomeResolver resolver,
        ILogger<LiveTradeSettlementService> logger)
    {
        _resolver = resolver;
        _logger = logger;
    }

    public async Task<bool?> TryResolveOutcomeAsync(
        TradeEntity trade,
        ChartCandle? closedCandle,
        CancellationToken ct = default)
    {
        _ = closedCandle;
        var outcome = await _resolver.TryResolveOutcomeAsync(trade, ct: ct);
        if (outcome == null)
        {
            _logger.LogDebug(
                "Live settlement deferred for trade {TradeId} candle {CandleTime} (awaiting Polymarket resolution / Activity)",
                trade.Id,
                trade.CandleTime);
        }

        return outcome;
    }
}
