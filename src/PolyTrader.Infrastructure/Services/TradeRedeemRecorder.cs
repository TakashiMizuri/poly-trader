using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;

namespace PolyTrader.Infrastructure.Services;

public static class TradeRedeemRecorder
{
    public static async Task MarkConditionRedeemedAsync(
        PolyTraderDbContext db,
        string conditionId,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(conditionId))
        {
            return;
        }

        var normalized = conditionId.Trim();
        var now = DateTime.UtcNow;
        var trades = await db.Trades
            .Include(t => t.Market)
            .Where(t =>
                t.Mode == TradingMode.Live
                && t.Won == true
                && t.RedeemedAt == null
                && t.Market != null
                && t.Market.ConditionId == normalized)
            .ToListAsync(ct);

        if (trades.Count == 0)
        {
            return;
        }

        foreach (var trade in trades)
        {
            trade.RedeemedAt = now;
        }

        await db.SaveChangesAsync(ct);
    }
}
