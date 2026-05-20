using Microsoft.AspNetCore.Mvc;

using Microsoft.EntityFrameworkCore;

using PolyTrader.Core.Abstractions;

using PolyTrader.Core.Models;

using PolyTrader.Core.Strategy;

using PolyTrader.Infrastructure;

using PolyTrader.Infrastructure.Data;

using PolyTrader.Infrastructure.Entities;



namespace PolyTrader.Api.Controllers;



[ApiController]

[Route("api/[controller]")]

public sealed class EngineController : ControllerBase

{

    private readonly PolyTraderDbContext _db;

    private readonly ITradingEventPublisher _publisher;



    public EngineController(PolyTraderDbContext db, ITradingEventPublisher publisher)

    {

        _db = db;

        _publisher = publisher;

    }



    [HttpGet]

    public async Task<ActionResult<EngineSettingsDto>> Get(CancellationToken ct)

    {

        var s = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);

        return Ok(await MapAsync(s, ct));

    }



    [HttpPut]

    public async Task<ActionResult<EngineSettingsDto>> Update(

        [FromBody] UpdateEngineSettingsRequest req,

        CancellationToken ct)

    {

        var s = await _db.EngineSettings.FirstAsync(ct);

        var wasRunning = s.IsRunning;



        if (req.TradingMode is not null

            && Enum.TryParse<TradingMode>(req.TradingMode, true, out var mode))

        {

            s.TradingMode = mode;

        }



        if (req.ActivePaperAccountId.HasValue)

        {

            var accountExists = await _db.PaperAccounts.AnyAsync(

                a => a.Id == req.ActivePaperAccountId.Value && !a.IsArchived,

                ct);

            if (!accountExists)

            {

                return BadRequest("Paper account not found or archived.");

            }



            s.ActivePaperAccountId = req.ActivePaperAccountId.Value;

            s.TradingMode = TradingMode.Paper;

        }



        var stakeError = TryApplyPendingStakePatch(s, req, out var stakeTouched);

        if (stakeError is not null)

        {

            return stakeError;

        }



        if (req.IsRunning.HasValue)

        {

            s.IsRunning = req.IsRunning.Value;

        }



        if (stakeTouched && !s.IsRunning)

        {

            EngineStakeSettings.ApplyPendingToActive(s);

        }

        else if (req.IsRunning == true && !wasRunning)

        {

            EngineStakeSettings.ApplyPendingToActive(s);

        }



        if (req.CommissionPercent.HasValue) s.CommissionPercent = req.CommissionPercent.Value;

        s.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        await _publisher.PublishEngineStatusAsync(s.IsRunning, s.TradingMode.ToString(), ct);



        if (s.TradingMode == TradingMode.Paper && s.ActivePaperAccountId is int activeId)

        {

            var balance = await _db.PaperAccounts

                .Where(a => a.Id == activeId)

                .Select(a => a.Balance)

                .FirstOrDefaultAsync(ct);

            await _publisher.PublishBalanceUpdatedAsync(balance, activeId, ct);

        }



        return Ok(await MapAsync(s, ct));

    }



    private static ActionResult? TryApplyPendingStakePatch(

        EngineSettingsEntity s,

        UpdateEngineSettingsRequest req,

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

            return new BadRequestObjectResult(

                $"Fixed stake must be at least ${SafeBetStake.MinBetStake}.");

        }



        if (req.BetStakePercent.HasValue

            && (req.BetStakePercent.Value <= 0 || req.BetStakePercent.Value > 100))

        {

            stakeTouched = false;

            return new BadRequestObjectResult(

                "Stake percent must be between 0 and 100 (exclusive of 0).");

        }



        if (req.MaxBetStakeUsd.HasValue)

        {

            var max = req.MaxBetStakeUsd.Value;

            if (max > 0 && max < SafeBetStake.MinBetStake)

            {

                stakeTouched = false;

                return new BadRequestObjectResult(

                    $"Max stake must be at least ${SafeBetStake.MinBetStake} or unset.");

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



    private async Task<EngineSettingsDto> MapAsync(EngineSettingsEntity s, CancellationToken ct)

    {

        PaperAccountEntity? active = null;

        if (s.ActivePaperAccountId is int id)

        {

            active = await _db.PaperAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);

        }



        return new EngineSettingsDto(

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

            s.UpdatedAt);

    }



    public sealed record EngineSettingsDto(

        string TradingMode,

        bool IsRunning,

        string BetStakeMode,

        double BetStakeUsd,

        double BetStakePercent,

        double? MaxBetStakeUsd,

        string ActiveBetStakeMode,

        double ActiveBetStakeUsd,

        double ActiveBetStakePercent,

        double? ActiveMaxBetStakeUsd,

        bool HasPendingStakeChanges,

        double CommissionPercent,

        int? ActivePaperAccountId,

        string? ActivePaperAccountName,

        double? ActivePaperBalance,

        DateTime UpdatedAt);



    public sealed record UpdateEngineSettingsRequest(

        string? TradingMode,

        int? ActivePaperAccountId,

        bool? IsRunning,

        string? BetStakeMode,

        double? BetStakeUsd,

        double? BetStakePercent,

        double? MaxBetStakeUsd,

        bool? ClearMaxBetStakeUsd,

        double? CommissionPercent);

}

