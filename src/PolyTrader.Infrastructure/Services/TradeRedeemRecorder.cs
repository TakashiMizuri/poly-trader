using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public static class TradeRedeemRecorder
{
    public static async Task MarkConditionRedeemedAsync(
        PolyTraderDbContext db,
        string conditionId,
        CancellationToken ct = default)
    {
        var normalized = PolymarketConditionId.Normalize(conditionId);
        if (normalized == null)
        {
            return;
        }

        var now = DateTime.UtcNow;
        var trades = await db.Trades
            .Include(t => t.Market)
            .Where(t =>
                t.Mode == TradingMode.Live
                && t.Won == true
                && t.RedeemedAt == null
                && t.Market != null)
            .ToListAsync(ct);

        var marked = 0;
        foreach (var trade in trades)
        {
            if (!PolymarketConditionId.Equals(trade.Market!.ConditionId, normalized))
            {
                continue;
            }

            trade.RedeemedAt = now;
            marked++;
        }

        if (marked > 0)
        {
            await db.SaveChangesAsync(ct);
        }
    }

    /// <summary>
    /// Clears <see cref="Entities.TradeEntity.RedeemedAt"/> backlog when tokens are no longer redeemable
    /// (redeemed on-chain outside our tx path, or Data API no longer lists them as redeemable).
    /// </summary>
    public static async Task<int> SyncRedeemedWinsFromDataApiAsync(
        PolyTraderDbContext db,
        IPolymarketDataApiService dataApi,
        CancellationToken ct = default)
    {
        var wallet = dataApi.ResolveWalletAddress();
        if (string.IsNullOrWhiteSpace(wallet))
        {
            return 0;
        }

        var pending = await db.Trades
            .Include(t => t.Market)
            .Where(t =>
                t.Mode == TradingMode.Live
                && t.Won == true
                && t.RedeemedAt == null
                && t.Market != null)
            .ToListAsync(ct);

        if (pending.Count == 0)
        {
            return 0;
        }

        var now = DateTime.UtcNow;
        var marked = 0;
        foreach (var trade in pending)
        {
            var tokenId = ResolveOutcomeTokenId(trade);
            if (string.IsNullOrWhiteSpace(tokenId))
            {
                continue;
            }

            var stillRedeemable = await dataApi.TryIsOutcomeTokenRedeemableAsync(wallet, tokenId, ct);
            if (stillRedeemable != false)
            {
                continue;
            }

            trade.RedeemedAt = now;
            marked++;
        }

        if (marked > 0)
        {
            await db.SaveChangesAsync(ct);
        }

        return marked;
    }

    private static string? ResolveOutcomeTokenId(Entities.TradeEntity trade)
    {
        if (trade.Market == null)
        {
            return null;
        }

        return trade.Side == TradeSide.Up
            ? trade.Market.YesTokenId
            : trade.Market.NoTokenId;
    }
}
