using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Polymarket;

public interface ILiveTradeSettlementService
{
    /// <summary>
    /// Resolves win/loss from Polymarket (Gamma / Data API). Binance OHLC only as last resort.
    /// </summary>
    Task<bool?> TryResolveOutcomeAsync(
        TradeEntity trade,
        ChartCandle? closedCandle,
        CancellationToken ct = default);
}
