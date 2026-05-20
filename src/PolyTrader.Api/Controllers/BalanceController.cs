using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class BalanceController : ControllerBase
{
    private readonly PolyTraderDbContext _db;
    private readonly IPolymarketClobService _clob;

    public BalanceController(PolyTraderDbContext db, IPolymarketClobService clob)
    {
        _db = db;
        _clob = clob;
    }

    [HttpGet]
    public async Task<ActionResult<object>> Get(CancellationToken ct)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var liveBalance = await _clob.GetCollateralBalanceAsync(ct);

        double? paperBalance = null;
        string? paperAccountName = null;
        int? paperAccountId = null;

        if (settings.ActivePaperAccountId is int id)
        {
            var account = await _db.PaperAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
            if (account != null)
            {
                paperBalance = account.Balance;
                paperAccountName = account.Name;
                paperAccountId = account.Id;
            }
        }

        return Ok(new
        {
            paperBalance,
            paperAccountId,
            paperAccountName,
            liveBalance,
            mode = settings.TradingMode.ToString(),
            activePaperAccountId = settings.ActivePaperAccountId
        });
    }

    [HttpGet("history")]
    public async Task<ActionResult<IEnumerable<object>>> History(
        [FromQuery] int limit = 200,
        [FromQuery] int? paperAccountId = null,
        CancellationToken ct = default)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var accountId = paperAccountId
            ?? (settings.TradingMode == TradingMode.Paper ? settings.ActivePaperAccountId : null);

        var query = _db.BalanceSnapshots.AsNoTracking();
        if (accountId is int id)
        {
            query = query.Where(b => b.PaperAccountId == id);
        }
        else if (settings.TradingMode == TradingMode.Live)
        {
            query = query.Where(b => b.PaperAccountId == 0);
        }

        var rows = await query
            .OrderByDescending(b => b.Timestamp)
            .Take(limit)
            .ToListAsync(ct);

        return Ok(rows.Select(b => new
        {
            time = new DateTimeOffset(b.Timestamp).ToUnixTimeSeconds(),
            value = b.Equity ?? b.CashBalance,
            source = b.Source,
            paperAccountId = b.PaperAccountId
        }).OrderBy(x => x.time));
    }
}
