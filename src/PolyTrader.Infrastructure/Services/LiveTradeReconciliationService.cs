using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

/// <summary>
/// Corrects live <see cref="TradeEntity.Won"/> / <see cref="TradeEntity.PnlUsd"/> and <see cref="TradeEntity.RedeemedAt"/>
/// using Polymarket Gamma and on-chain Activity (book PnL vs wallet USDC).
/// </summary>
public sealed class LiveTradeReconciliationService
{
    private const double LiveTradeCommissionPercent = 0;

    private readonly IPolymarketDataApiService _dataApi;
    private readonly LiveTradeOutcomeResolver _outcomeResolver;
    private readonly ITradingEventPublisher? _publisher;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<LiveTradeReconciliationService> _logger;

    public LiveTradeReconciliationService(
        IPolymarketDataApiService dataApi,
        LiveTradeOutcomeResolver outcomeResolver,
        IOptions<PolyTraderOptions> options,
        ILogger<LiveTradeReconciliationService> logger,
        ITradingEventPublisher? publisher = null)
    {
        _dataApi = dataApi;
        _outcomeResolver = outcomeResolver;
        _options = options.Value;
        _logger = logger;
        _publisher = publisher;
    }

    public async Task<LiveTradeReconcileResult> ReconcileAsync(
        PolyTraderDbContext db,
        CancellationToken ct = default)
    {
        var wallet = _dataApi.ResolveWalletAddress();
        if (string.IsNullOrWhiteSpace(wallet))
        {
            return new LiveTradeReconcileResult();
        }

        var trades = await db.Trades
            .Include(t => t.Market)
            .Where(t => t.Mode == TradingMode.Live)
            .OrderBy(t => t.CandleTime)
            .ToListAsync(ct);

        if (trades.Count == 0)
        {
            return new LiveTradeReconcileResult();
        }

        var start = trades.Min(t => t.CandleTime) - 3600;
        var events = await _dataApi.FetchActivityAsync(start, null, ct);
        var byCondition = PolymarketActivityLedger.BuildByConditionId(events);
        var byEventSlug = PolymarketActivityLedger.BuildByEventSlug(events);

        var corrected = 0;
        var settledFromOpen = 0;
        var publishList = new List<TradeEntity>();

        foreach (var trade in trades)
        {
            var resolved = await _outcomeResolver.TryResolveOutcomeAsync(
                trade,
                byCondition,
                byEventSlug,
                ct);

            if (resolved == null)
            {
                continue;
            }

            var priorWon = trade.Won;
            if (priorWon == resolved
                && trade.SettlementStatus == TradeSettlementStatus.Confirmed)
            {
                continue;
            }

            if (priorWon == resolved
                && trade.SettlementStatus == TradeSettlementStatus.Provisional)
            {
                TradeRecording.ConfirmExistingSettlement(trade, "polymarket");
                db.Trades.Update(trade);
                corrected++;
                publishList.Add(trade);
                continue;
            }

            if (priorWon == true && resolved == false)
            {
                var eventSlug = PolymarketActivityLedger.BuildBtc5mEventSlug(
                    _options.BtcMarketSlugPrefix,
                    trade.CandleTime);
                var summary = PolymarketActivityLedger.ResolveSummary(
                    byCondition,
                    byEventSlug,
                    trade.Market?.ConditionId,
                    eventSlug);
                if (summary == null || summary.NetUsdc > -0.5)
                {
                    continue;
                }
            }

            var wasOpen = trade.Won == null;
            LiveTradeOutcomeResolver.ApplyOutcome(trade, resolved.Value, LiveTradeCommissionPercent);
            trade.SettlementStatus = TradeSettlementStatus.Confirmed;
            trade.SettlementSource = "polymarket";
            trade.ConfirmedSettledAt = DateTime.UtcNow;
            if (trade.ProvisionalSettledAt == null)
            {
                trade.ProvisionalSettledAt = trade.ConfirmedSettledAt;
            }

            db.Trades.Update(trade);
            corrected++;
            publishList.Add(trade);

            if (wasOpen)
            {
                settledFromOpen++;
            }

            _logger.LogWarning(
                "Reconciled trade {TradeId} candle {CandleTime}: Won {Old} → {New} PnlUsd={Pnl:F2}",
                trade.Id,
                trade.CandleTime,
                priorWon?.ToString() ?? "null",
                resolved.Value,
                trade.PnlUsd);
        }

        var redeemedSynced = TradeRedeemRecorder.ApplyRedeemedAtFromActivity(trades, byCondition);

        if (corrected > 0 || redeemedSynced > 0)
        {
            await db.SaveChangesAsync(ct);
        }

        if (_publisher != null)
        {
            foreach (var trade in publishList)
            {
                await _publisher.PublishTradePlacedAsync(
                    TradeEventDtoFactory.FromEntity(trade),
                    ct);
            }
        }

        return new LiveTradeReconcileResult
        {
            TradesChecked = trades.Count,
            OutcomesCorrected = corrected,
            RedeemedAtSynced = redeemedSynced,
            SettledFromOpen = settledFromOpen,
        };
    }
}
