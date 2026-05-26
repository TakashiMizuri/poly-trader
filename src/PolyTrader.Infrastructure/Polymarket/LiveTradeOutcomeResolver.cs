using System.Collections.Frozen;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>
/// Resolves live trade win/loss from Polymarket (Gamma, Data API positions, Activity USDC).
/// Does not use Binance OHLC — candle fallback caused book PnL to diverge from wallet USDC.
/// </summary>
public sealed class LiveTradeOutcomeResolver
{
    private readonly IPolymarketGammaService _gamma;
    private readonly IPolymarketDataApiService _dataApi;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<LiveTradeOutcomeResolver> _logger;

    public LiveTradeOutcomeResolver(
        IPolymarketGammaService gamma,
        IPolymarketDataApiService dataApi,
        IOptions<PolyTraderOptions> options,
        ILogger<LiveTradeOutcomeResolver> logger)
    {
        _gamma = gamma;
        _dataApi = dataApi;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<bool?> TryResolveOutcomeAsync(
        TradeEntity trade,
        FrozenDictionary<string, PolymarketMarketCashSummary>? activityByCondition = null,
        FrozenDictionary<string, PolymarketMarketCashSummary>? activityByEventSlug = null,
        CancellationToken ct = default)
    {
        var fromGamma = await TryResolveFromGammaAsync(trade, ct);
        if (fromGamma != null)
        {
            return fromGamma;
        }

        var fromPosition = await TryResolveFromPositionAsync(trade, ct);
        if (fromPosition != null)
        {
            return fromPosition;
        }

        return await TryResolveFromActivityAsync(
            trade,
            activityByCondition,
            activityByEventSlug,
            ct);
    }

    public static void ApplyOutcome(TradeEntity trade, bool won, double commissionPercent) =>
        TradeRecording.ApplySettlement(trade, won, commissionPercent);

    private async Task<bool?> TryResolveFromGammaAsync(TradeEntity trade, CancellationToken ct)
    {
        var conditionId = trade.Market?.ConditionId;
        if (string.IsNullOrWhiteSpace(conditionId))
        {
            return null;
        }

        var winningSide = await _gamma.TryGetResolvedWinningSideAsync(conditionId, ct);
        if (winningSide == null)
        {
            return null;
        }

        var won = trade.Side == winningSide.Value;
        _logger.LogInformation(
            "Live outcome trade {TradeId} candle {CandleTime}: Gamma → {Outcome}",
            trade.Id,
            trade.CandleTime,
            won ? "won" : "lost");
        return won;
    }

    private async Task<bool?> TryResolveFromPositionAsync(TradeEntity trade, CancellationToken ct)
    {
        var wallet = _dataApi.ResolveWalletAddress();
        if (string.IsNullOrWhiteSpace(wallet) || trade.Market == null)
        {
            return null;
        }

        var tokenId = trade.Side == TradeSide.Up
            ? trade.Market.YesTokenId
            : trade.Market.NoTokenId;
        if (string.IsNullOrWhiteSpace(tokenId))
        {
            return null;
        }

        var fromPosition = await _dataApi.TryInferOutcomeFromPositionAsync(wallet, tokenId, ct);
        if (fromPosition == null)
        {
            return null;
        }

        _logger.LogInformation(
            "Live outcome trade {TradeId} candle {CandleTime}: Data API position → {Outcome}",
            trade.Id,
            trade.CandleTime,
            fromPosition.Value ? "won" : "lost");
        return fromPosition.Value;
    }

    private async Task<bool?> TryResolveFromActivityAsync(
        TradeEntity trade,
        FrozenDictionary<string, PolymarketMarketCashSummary>? activityByCondition,
        FrozenDictionary<string, PolymarketMarketCashSummary>? activityByEventSlug,
        CancellationToken ct)
    {
        var eventSlug = PolymarketActivityLedger.BuildBtc5mEventSlug(
            _options.BtcMarketSlugPrefix,
            trade.CandleTime);
        var conditionId = trade.Market?.ConditionId;

        PolymarketMarketCashSummary? summary;
        if (activityByCondition != null && activityByEventSlug != null)
        {
            summary = PolymarketActivityLedger.ResolveSummary(
                activityByCondition,
                activityByEventSlug,
                conditionId,
                eventSlug);
        }
        else
        {
            var start = trade.CandleTime - 300;
            var events = await _dataApi.FetchActivityAsync(start, null, ct);
            var byCond = PolymarketActivityLedger.BuildByConditionId(events);
            var bySlug = PolymarketActivityLedger.BuildByEventSlug(events);
            summary = PolymarketActivityLedger.ResolveSummary(byCond, bySlug, conditionId, eventSlug);
        }

        var inferred = PolymarketActivityLedger.InferWonFromCashFlow(summary, trade.StakeUsd);
        if (inferred == null)
        {
            return null;
        }

        _logger.LogInformation(
            "Live outcome trade {TradeId} candle {CandleTime}: Activity net=${Net:F2} redeem=${Redeem:F2} → {Outcome}",
            trade.Id,
            trade.CandleTime,
            summary?.NetUsdc ?? 0,
            summary?.RedeemUsdc ?? 0,
            inferred.Value ? "won" : "lost");
        return inferred.Value;
    }
}
