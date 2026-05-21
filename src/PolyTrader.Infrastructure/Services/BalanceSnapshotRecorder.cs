using Microsoft.EntityFrameworkCore;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Services;

/// <summary>Upserts one balance point per 5m candle (paper account or live).</summary>
internal static class BalanceSnapshotRecorder
{
    public static async Task RecordAsync(
        PolyTraderDbContext db,
        int paperAccountId,
        long candleTimeMs,
        double balance,
        string source,
        CancellationToken ct = default)
    {
        if (candleTimeMs <= 0)
        {
            return;
        }

        var existing = await db.BalanceSnapshots
            .FirstOrDefaultAsync(
                b => b.PaperAccountId == paperAccountId && b.CandleTime == candleTimeMs,
                ct);

        if (existing != null)
        {
            existing.CashBalance = balance;
            existing.Equity = balance;
            existing.Source = source;
            existing.Timestamp = DateTime.UtcNow;
            return;
        }

        db.BalanceSnapshots.Add(new BalanceSnapshotEntity
        {
            PaperAccountId = paperAccountId,
            CandleTime = candleTimeMs,
            CashBalance = balance,
            Equity = balance,
            Source = source,
            Timestamp = DateTime.UtcNow,
        });
    }
}
