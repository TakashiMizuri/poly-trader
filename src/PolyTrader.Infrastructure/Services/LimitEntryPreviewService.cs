using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed class LimitEntryPreviewService
{
    private readonly PolyTraderDbContext _db;
    private readonly IPolymarketGammaService _gamma;
    private readonly IPolymarketClobService _clob;
    private readonly IPolymarketMarketWebSocket _marketWs;

    public LimitEntryPreviewService(
        PolyTraderDbContext db,
        IPolymarketGammaService gamma,
        IPolymarketClobService clob,
        IPolymarketMarketWebSocket marketWs)
    {
        _db = db;
        _gamma = gamma;
        _clob = clob;
        _marketWs = marketWs;
    }

    public async Task<LimitEntryPreview> BuildAsync(
        LimitEntryPreviewRequest request,
        CancellationToken ct = default)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var mode = request.TradingMode ?? settings.TradingMode;
        var isPaper = mode == TradingMode.Paper;

        double? balance = null;
        if (isPaper)
        {
            var paperId = request.PaperAccountId ?? settings.ActivePaperAccountId;
            if (paperId is int id)
            {
                balance = await _db.PaperAccounts
                    .Where(a => a.Id == id && !a.IsArchived)
                    .Select(a => (double?)a.Balance)
                    .FirstOrDefaultAsync(ct);
            }
        }
        else
        {
            balance = _clob.IsConfigured
                ? await _clob.GetCollateralBalanceAsync(ct)
                : null;
        }

        var stakeMode = request.BetStakeMode ?? settings.PendingBetStakeMode;
        var stakeUsd = request.BetStakeUsd ?? settings.PendingBetStakeUsd;
        var stakePercent = request.BetStakePercent ?? settings.PendingBetStakePercent;
        var maxCap = request.ClearMaxBetStakeUsd == true
            ? null
            : request.MaxBetStakeUsd ?? settings.PendingMaxBetStakeUsd;

        var workingBalance = balance ?? 0;
        var stakeParams = TrendBetStrategyParams.ForLiveEngine(
            workingBalance,
            stakeMode,
            stakeUsd,
            stakePercent,
            maxCap,
            settings.CommissionPercent);
        var requested = BetStakeResolver.ResolveForBalance(workingBalance, stakeParams)
            ?? (stakeMode == BetStakeMode.Fixed
                ? stakeUsd
                : BetStakeResolver.RequestedStake(workingBalance, stakeParams));

        var marketReferenceBid = await TryResolveReferenceBidAsync(ct);
        var referenceBid = ResolvePreviewBid(request.ReferenceBid, marketReferenceBid);
        LimitEntryStakePlan? plan = null;
        if (referenceBid is > 0)
        {
            plan = LimitEntryRules.Plan(workingBalance, requested, maxCap, referenceBid.Value);
        }

        double? minBalanceOneTrade = null;
        double? minBalanceConfigured = null;
        if (referenceBid is > 0)
        {
            minBalanceOneTrade = LimitEntryRules.MinBalanceForOneLimitTrade(referenceBid.Value);
            minBalanceConfigured = LimitEntryRules.MinBalanceForConfiguredStake(
                referenceBid.Value,
                stakeMode,
                stakeUsd,
                stakePercent,
                maxCap);
        }

        return new LimitEntryPreview(
            mode.ToString(),
            balance,
            referenceBid,
            marketReferenceBid,
            request.ReferenceBid is > 0 and <= 1,
            referenceBid == null ? "Bid price unavailable" : null,
            LimitEntryRules.MinOrderShares,
            referenceBid is > 0 ? LimitEntryRules.MinStakeUsd(referenceBid.Value) : null,
            requested,
            plan?.EffectiveStakeUsd ?? 0,
            plan?.CanTrade ?? false,
            plan?.WillBump ?? false,
            plan?.BlockReason,
            minBalanceOneTrade,
            minBalanceConfigured,
            stakeMode == BetStakeMode.Percent ? stakePercent : null,
            stakeMode == BetStakeMode.Fixed ? stakeUsd : null,
            maxCap);
    }

    private static double? ResolvePreviewBid(double? requestedBid, double? marketBid)
    {
        if (requestedBid is > 0 and <= 1)
        {
            return requestedBid.Value;
        }

        return marketBid;
    }

    private async Task<double?> TryResolveReferenceBidAsync(CancellationToken ct)
    {
        var windows = await _gamma.DiscoverBtc5mWindowsAsync(ct);
        var market = windows.Current ?? windows.NextScheduled;
        if (market == null
            || string.IsNullOrWhiteSpace(market.YesTokenId)
            || string.IsNullOrWhiteSpace(market.NoTokenId))
        {
            return null;
        }

        var yesBid = await TryBidAsync(market.YesTokenId, ct);
        var noBid = await TryBidAsync(market.NoTokenId, ct);
        var bids = new[] { yesBid, noBid }.Where(b => b is > 0 and <= 1).ToList();
        return bids.Count > 0 ? bids.Max() : null;
    }

    private async Task<double?> TryBidAsync(string tokenId, CancellationToken ct)
    {
        static bool Valid(double? p) => p is > 0 and <= 1;

        var fromWs = _marketWs.Prices.GetOrCreate(tokenId).MakerBuyPrice
            ?? _marketWs.Prices.GetMid(tokenId);
        if (Valid(fromWs))
        {
            return fromWs;
        }

        var fromRest = await _clob.TryGetBidPriceAsync(tokenId, ct);
        return Valid(fromRest) ? fromRest : null;
    }
}

public sealed record LimitEntryPreviewRequest(
    TradingMode? TradingMode = null,
    int? PaperAccountId = null,
    BetStakeMode? BetStakeMode = null,
    double? BetStakeUsd = null,
    double? BetStakePercent = null,
    double? MaxBetStakeUsd = null,
    bool ClearMaxBetStakeUsd = false,
    double? ReferenceBid = null);

public sealed record LimitEntryPreview(
    string TradingMode,
    double? BalanceUsd,
    double? ReferenceBid,
    double? MarketReferenceBid,
    bool BidIsCustom,
    string? BidUnavailableReason,
    decimal MinOrderShares,
    double? ClobMinStakeUsd,
    double RequestedStakeUsd,
    double EffectiveStakeUsd,
    bool CanTrade,
    bool WillBump,
    string? BlockReason,
    double? MinBalanceOneTradeUsd,
    double? MinBalanceConfiguredUsd,
    double? StakePercent,
    double? StakeUsd,
    double? MaxBetStakeUsd);
