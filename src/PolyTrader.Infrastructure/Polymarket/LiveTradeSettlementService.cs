using Microsoft.Extensions.Logging;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class LiveTradeSettlementService : ILiveTradeSettlementService
{
    private readonly IPolymarketGammaService _gamma;
    private readonly IPolymarketDataApiService _dataApi;
    private readonly ILogger<LiveTradeSettlementService> _logger;

    public LiveTradeSettlementService(
        IPolymarketGammaService gamma,
        IPolymarketDataApiService dataApi,
        ILogger<LiveTradeSettlementService> logger)
    {
        _gamma = gamma;
        _dataApi = dataApi;
        _logger = logger;
    }

    public async Task<bool?> TryResolveOutcomeAsync(
        TradeEntity trade,
        ChartCandle? closedCandle,
        CancellationToken ct = default)
    {
        var conditionId = trade.Market?.ConditionId;
        if (!string.IsNullOrWhiteSpace(conditionId))
        {
            var winningSide = await _gamma.TryGetResolvedWinningSideAsync(conditionId, ct);
            if (winningSide != null)
            {
                var won = trade.Side == winningSide.Value;
                _logger.LogInformation(
                    "Live settlement trade {TradeId} candle {CandleTime}: Gamma resolution condition={ConditionId} → {Outcome}",
                    trade.Id,
                    trade.CandleTime,
                    conditionId,
                    won ? "won" : "lost");
                return won;
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
                    _logger.LogInformation(
                        "Live settlement trade {TradeId} candle {CandleTime}: Data API position → {Outcome}",
                        trade.Id,
                        trade.CandleTime,
                        fromPosition.Value ? "won" : "lost");
                    return fromPosition.Value;
                }
            }
        }

        if (closedCandle != null)
        {
            _logger.LogWarning(
                "Live trade {TradeId} candle {CandleTime}: Polymarket resolution unavailable; using Binance OHLC fallback",
                trade.Id,
                trade.CandleTime);
            var fallbackWon = TrendBetStrategySimulator.IsBetWon(trade.Trend, closedCandle);
            _logger.LogWarning(
                "Live settlement trade {TradeId} candle {CandleTime}: Binance OHLC fallback → {Outcome}",
                trade.Id,
                trade.CandleTime,
                fallbackWon ? "won" : "lost");
            return fallbackWon;
        }

        _logger.LogDebug(
            "Live settlement trade {TradeId} candle {CandleTime}: outcome not yet available",
            trade.Id,
            trade.CandleTime);
        return null;
    }
}
