using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Services;

public sealed class GlobalResetService(
    PolyTraderDbContext db,
    InProgressWindowSkipService inProgressSkips,
    ILogFileClearService logFiles,
    ILogger<GlobalResetService> logger)
{
    public async Task<GlobalResetResult> ResetAsync(CancellationToken ct = default)
    {
        logger.LogWarning(
            "Global reset requested: wiping trades, markets, paper accounts, snapshots, and log files");

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
            settings.CommissionPercent = 3.5;
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            await tx.CommitAsync(ct);

            await inProgressSkips.TryRecordEngineStoppedForInProgressWindowAsync(settings, ct);

            var logsDeleted = logFiles.ClearLogFiles();

            logger.LogWarning(
                "Global reset completed: paper account {AccountId} ({Name}) balance=${Balance:F2} engine stopped; deleted {LogFileCount} log file(s)",
                defaultAccount.Id,
                defaultAccount.Name,
                defaultAccount.Balance,
                logsDeleted);

            return new GlobalResetResult(
                settings.TradingMode.ToString(),
                settings.IsRunning,
                defaultAccount.Id,
                defaultAccount.Name,
                defaultAccount.Balance);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Global reset failed; transaction rolled back");
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
