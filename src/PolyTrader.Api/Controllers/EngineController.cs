using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
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

        if (req.IsRunning.HasValue) s.IsRunning = req.IsRunning.Value;
        if (req.BetStakeUsd.HasValue) s.BetStakeUsd = req.BetStakeUsd.Value;
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
            s.BetStakeUsd,
            s.CommissionPercent,
            s.ActivePaperAccountId,
            active?.Name,
            active?.Balance,
            s.UpdatedAt);
    }

    public sealed record EngineSettingsDto(
        string TradingMode,
        bool IsRunning,
        double BetStakeUsd,
        double CommissionPercent,
        int? ActivePaperAccountId,
        string? ActivePaperAccountName,
        double? ActivePaperBalance,
        DateTime UpdatedAt);

    public sealed record UpdateEngineSettingsRequest(
        string? TradingMode,
        int? ActivePaperAccountId,
        bool? IsRunning,
        double? BetStakeUsd,
        double? CommissionPercent);
}
