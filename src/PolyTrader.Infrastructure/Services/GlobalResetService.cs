using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Services;

public sealed class GlobalResetService(PolyTraderDbContext db)
{
    public async Task<GlobalResetResult> ResetAsync(CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var settings = await db.EngineSettings.FirstAsync(ct);
            settings.IsRunning = false;
            settings.ActivePaperAccountId = null;
            await db.SaveChangesAsync(ct);

            await db.SkippedBets.ExecuteDeleteAsync(ct);
            await db.Trades.ExecuteDeleteAsync(ct);
            await db.Positions.ExecuteDeleteAsync(ct);
            await db.BalanceSnapshots.ExecuteDeleteAsync(ct);
            await db.CandleSnapshots.ExecuteDeleteAsync(ct);
            await db.Markets.ExecuteDeleteAsync(ct);
            await db.PaperAccounts.ExecuteDeleteAsync(ct);

            var defaultAccount = new PaperAccountEntity
            {
                Name = "Default paper",
                InitialBalance = 100,
                Balance = 100,
            };
            db.PaperAccounts.Add(defaultAccount);
            await db.SaveChangesAsync(ct);

            settings.TradingMode = TradingMode.Paper;
            settings.ActivePaperAccountId = defaultAccount.Id;
            settings.BetStakeMode = Core.Strategy.BetStakeMode.Percent;
            settings.BetStakeUsd = 1;
            settings.BetStakePercent = 3;
            settings.MaxBetStakeUsd = 500;
            EngineStakeSettings.SyncPendingFromActive(settings);
            settings.CommissionPercent = 1.8;
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            await tx.CommitAsync(ct);

            return new GlobalResetResult(
                settings.TradingMode.ToString(),
                settings.IsRunning,
                defaultAccount.Id,
                defaultAccount.Name,
                defaultAccount.Balance);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    public sealed record GlobalResetResult(
        string TradingMode,
        bool IsRunning,
        int ActivePaperAccountId,
        string ActivePaperAccountName,
        double ActivePaperBalance);
}
