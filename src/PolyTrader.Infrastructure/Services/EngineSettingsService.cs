using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed class EngineSettingsService : IEngineSettingsService
{
    private readonly PolyTraderDbContext _db;
    private readonly ITradingEventPublisher _publisher;
    private readonly IPolymarketClobService _clob;
    private readonly InProgressWindowSkipService _inProgressSkips;
    private readonly ILogger<EngineSettingsService> _logger;

    public EngineSettingsService(
        PolyTraderDbContext db,
        ITradingEventPublisher publisher,
        IPolymarketClobService clob,
        InProgressWindowSkipService inProgressSkips,
        ILogger<EngineSettingsService> logger)
    {
        _db = db;
        _publisher = publisher;
        _clob = clob;
        _inProgressSkips = inProgressSkips;
        _logger = logger;
    }

    public async Task<EngineSettingsSnapshot> GetAsync(CancellationToken ct = default)
    {
        var s = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        return await MapAsync(s, ct);
    }

    public async Task<EngineSettingsUpdateResult> UpdateAsync(
        UpdateEngineSettingsCommand command,
        CancellationToken ct = default)
    {
        var s = await _db.EngineSettings.FirstAsync(ct);
        var wasRunning = s.IsRunning;

        _logger.LogInformation(
            "Engine settings update requested: running={Running} mode={Mode} paperAccount={PaperId}",
            command.IsRunning,
            command.TradingMode,
            command.ActivePaperAccountId);

        if (command.TradingMode is not null
            && Enum.TryParse<TradingMode>(command.TradingMode, true, out var mode))
        {
            s.TradingMode = mode;
        }

        if (command.ActivePaperAccountId.HasValue)
        {
            var accountExists = await _db.PaperAccounts.AnyAsync(
                a => a.Id == command.ActivePaperAccountId.Value && !a.IsArchived,
                ct);
            if (!accountExists)
            {
                return new EngineSettingsUpdateResult(false, null, "Paper account not found or archived.");
            }

            s.ActivePaperAccountId = command.ActivePaperAccountId.Value;
            s.TradingMode = TradingMode.Paper;
        }

        var stakeError = TryApplyPendingStakePatch(s, command, out var stakeTouched);
        if (stakeError is not null)
        {
            return new EngineSettingsUpdateResult(false, null, stakeError);
        }

        if (command.IsRunning.HasValue)
        {
            if (command.IsRunning.Value)
            {
                var liveError = await ValidateLiveStartAsync(s, ct);
                if (liveError != null)
                {
                    return new EngineSettingsUpdateResult(false, null, liveError);
                }
            }

            s.IsRunning = command.IsRunning.Value;
        }

        if (stakeTouched && !s.IsRunning)
        {
            EngineStakeSettings.ApplyPendingToActive(s);
        }
        else if (command.IsRunning == true && !wasRunning)
        {
            EngineStakeSettings.ApplyPendingToActive(s);
        }

        if (command.CommissionPercent.HasValue)
        {
            s.CommissionPercent = command.CommissionPercent.Value;
        }

        if (command.AutoRedeemEnabled.HasValue)
        {
            s.AutoRedeemEnabled = command.AutoRedeemEnabled.Value;
        }

        s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        if (command.IsRunning == true && !wasRunning)
        {
            await _inProgressSkips.TryRecordEngineStoppedForInProgressWindowAsync(s, ct);
        }

        await _publisher.PublishEngineStatusAsync(s.IsRunning, s.TradingMode.ToString(), ct);

        _logger.LogInformation(
            "Engine settings saved: running={Running} mode={Mode} stakeMode={StakeMode} activePaper={PaperId}",
            s.IsRunning,
            s.TradingMode,
            s.BetStakeMode,
            s.ActivePaperAccountId);

        if (s.TradingMode == TradingMode.Paper && s.ActivePaperAccountId is int activeId)
        {
            var balance = await _db.PaperAccounts
                .Where(a => a.Id == activeId)
                .Select(a => a.Balance)
                .FirstOrDefaultAsync(ct);
            await _publisher.PublishBalanceUpdatedAsync(balance, activeId, ct);
        }

        var snapshot = await MapAsync(s, ct);
        return new EngineSettingsUpdateResult(true, snapshot, null);
    }

    private static string? TryApplyPendingStakePatch(
        EngineSettingsEntity s,
        UpdateEngineSettingsCommand req,
        out bool stakeTouched)
    {
        stakeTouched = req.BetStakeMode is not null
            || req.BetStakeUsd.HasValue
            || req.BetStakePercent.HasValue
            || req.MaxBetStakeUsd.HasValue
            || req.ClearMaxBetStakeUsd == true;

        if (!stakeTouched)
        {
            return null;
        }

        BetStakeMode? mode = null;
        if (req.BetStakeMode is not null)
        {
            if (!Enum.TryParse<BetStakeMode>(req.BetStakeMode, true, out var stakeMode))
            {
                stakeTouched = false;
                return null;
            }

            mode = stakeMode;
        }

        if (req.BetStakeUsd.HasValue && req.BetStakeUsd.Value < SafeBetStake.MinBetStake)
        {
            stakeTouched = false;
            return $"Fixed stake must be at least ${SafeBetStake.MinBetStake}.";
        }

        if (req.BetStakePercent.HasValue
            && (req.BetStakePercent.Value <= 0 || req.BetStakePercent.Value > 100))
        {
            stakeTouched = false;
            return "Stake percent must be between 0 and 100 (exclusive of 0).";
        }

        if (req.MaxBetStakeUsd.HasValue)
        {
            var max = req.MaxBetStakeUsd.Value;
            if (max > 0 && max < SafeBetStake.MinBetStake)
            {
                stakeTouched = false;
                return $"Max stake must be at least ${SafeBetStake.MinBetStake} or unset.";
            }
        }

        EngineStakeSettings.ApplyPendingPatch(
            s,
            mode,
            req.BetStakeUsd,
            req.BetStakePercent,
            req.MaxBetStakeUsd,
            req.ClearMaxBetStakeUsd == true);

        return null;
    }

    private async Task<string?> ValidateLiveStartAsync(EngineSettingsEntity s, CancellationToken ct)
    {
        if (s.TradingMode != TradingMode.Live)
        {
            return null;
        }

        if (!_clob.IsConfigured)
        {
            return "Live engine requires Polymarket credentials.";
        }

        var balance = await _clob.GetCollateralBalanceAsync(ct);
        if (balance is null or < SafeBetStake.MinBetStake)
        {
            return $"Insufficient live USDC balance (${balance?.ToString("F2") ?? "unknown"}).";
        }

        return null;
    }

    private async Task<EngineSettingsSnapshot> MapAsync(EngineSettingsEntity s, CancellationToken ct)
    {
        PaperAccountEntity? active = null;
        if (s.ActivePaperAccountId is int id)
        {
            active = await _db.PaperAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
        }

        return new EngineSettingsSnapshot(
            s.TradingMode.ToString(),
            s.IsRunning,
            s.PendingBetStakeMode.ToString(),
            s.PendingBetStakeUsd,
            s.PendingBetStakePercent,
            s.PendingMaxBetStakeUsd,
            s.BetStakeMode.ToString(),
            s.BetStakeUsd,
            s.BetStakePercent,
            s.MaxBetStakeUsd,
            EngineStakeSettings.HasPendingChanges(s),
            s.CommissionPercent,
            s.ActivePaperAccountId,
            active?.Name,
            active?.Balance,
            s.AutoRedeemEnabled,
            s.UpdatedAt);
    }
}
