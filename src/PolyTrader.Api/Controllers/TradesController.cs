using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Api.Services;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class TradesController : ControllerBase
{
    private readonly PolyTraderDbContext _db;
    private readonly IPolymarketGammaService _gamma;

    public TradesController(PolyTraderDbContext db, IPolymarketGammaService gamma)
    {
        _db = db;
        _gamma = gamma;
    }

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
            .Include(t => t.Market)
            .OrderByDescending(t => t.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);
        return Ok(trades.Select(TradeMapper.ToDto));
    }

    [HttpGet("feed")]
    public async Task<ActionResult<IReadOnlyList<object>>> Feed(
        [FromQuery] int limit = 50,
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

        var windows = await _gamma.DiscoverBtc5mWindowsAsync(ct);
        var primary = windows.Current ?? windows.NextScheduled;
        var upcoming = windows.Current != null ? windows.NextScheduled : null;
        var groups = await TradeFeedBuilder.BuildAsync(
            _db,
            settings,
            modeFilter,
            contextId,
            limit,
            primary,
            upcoming,
            ct);
        return Ok(groups);
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
