using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Api.Services;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class TradesController : ControllerBase
{
    private readonly PolyTraderDbContext _db;

    public TradesController(PolyTraderDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> List(
        [FromQuery] int limit = 100,
        [FromQuery] string? mode = null,
        [FromQuery] int? paperAccountId = null,
        CancellationToken ct = default)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var query = _db.Trades.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(mode)
            && Enum.TryParse<TradingMode>(mode, true, out var parsedMode))
        {
            query = query.Where(t => t.Mode == parsedMode);
            if (parsedMode == TradingMode.Paper)
            {
                var accountId = paperAccountId ?? settings.ActivePaperAccountId;
                if (accountId is int id)
                {
                    query = query.Where(t => t.PaperAccountId == id);
                }
            }
            else
            {
                query = query.Where(t => t.PaperAccountId == 0);
            }
        }
        else if (settings.TradingMode == TradingMode.Paper && settings.ActivePaperAccountId is int activeId)
        {
            query = query.Where(t =>
                t.Mode != TradingMode.Paper || t.PaperAccountId == activeId);
        }

        var trades = await query
            .OrderByDescending(t => t.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);
        return Ok(trades.Select(TradeMapper.ToDto));
    }

    [HttpGet("chart-markers")]
    public async Task<ActionResult<IEnumerable<object>>> ChartMarkers(
        [FromQuery] int? paperAccountId = null,
        CancellationToken ct = default)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var query = _db.Trades.AsNoTracking();

        if (settings.TradingMode == TradingMode.Paper)
        {
            var accountId = paperAccountId ?? settings.ActivePaperAccountId;
            if (accountId is int id)
            {
                query = query.Where(t => t.Mode == TradingMode.Paper && t.PaperAccountId == id);
            }
        }
        else
        {
            query = query.Where(t => t.Mode == TradingMode.Live);
        }

        var trades = await query
            .OrderBy(t => t.CandleTime)
            .Take(500)
            .ToListAsync(ct);

        return Ok(trades.Select(t => new
        {
            time = t.CandleTime,
            side = t.Side.ToString(),
            trend = t.Trend.ToString(),
            mode = t.Mode.ToString(),
            won = t.Won,
            paperAccountId = t.PaperAccountId
        }));
    }
}
