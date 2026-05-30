using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Api.Services;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/analytics")]
public sealed class AnalyticsController : ControllerBase
{
    private readonly PolyTraderDbContext _db;

    public AnalyticsController(PolyTraderDbContext db)
    {
        _db = db;
    }

    [HttpGet("execution-gap")]
    public async Task<ActionResult<object>> ExecutionGap(
        [FromQuery] string? period = "7d",
        [FromQuery] string? mode = null,
        [FromQuery] int? paperAccountId = null,
        CancellationToken ct = default)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var modeFilter = settings.TradingMode;
        if (!string.IsNullOrWhiteSpace(mode)
            && Enum.TryParse<TradingMode>(mode, true, out var parsedMode))
        {
            modeFilter = parsedMode;
        }

        var contextId = 0;
        if (modeFilter == TradingMode.Paper)
        {
            var accountId = paperAccountId ?? settings.ActivePaperAccountId;
            if (accountId is int id)
            {
                contextId = id;
            }
        }

        var analytics = await ExecutionGapAnalyticsService.BuildAsync(
            _db,
            modeFilter,
            contextId,
            period,
            ct);
        return Ok(analytics);
    }
}
