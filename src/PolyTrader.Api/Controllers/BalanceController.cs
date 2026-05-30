using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Polymarket;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class BalanceController : ControllerBase
{
    private readonly PolyTraderDbContext _db;
    private readonly IPolymarketClobService _clob;
    private readonly BalanceHistoryService _history;

    public BalanceController(
        PolyTraderDbContext db,
        IPolymarketClobService clob,
        BalanceHistoryService history)
    {
        _db = db;
        _clob = clob;
        _history = history;
    }

    [HttpGet]
    public async Task<ActionResult<object>> Get(CancellationToken ct)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        double? liveBalance = null;
        if (_clob.IsConfigured)
        {
            try
            {
                liveBalance = await _clob.GetCollateralBalanceAsync(ct);
            }
            catch (OperationCanceledException)
            {
                // Client disconnected or Kestrel budget exceeded — return partial payload.
            }
        }

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
            clobConfigured = _clob.IsConfigured,
            mode = settings.TradingMode.ToString(),
            activePaperAccountId = settings.ActivePaperAccountId,
            commissionPercent = settings.CommissionPercent,
        });
    }

    [HttpGet("history")]
    public async Task<ActionResult<object>> History(
        [FromQuery] int? limit = null,
        [FromQuery] int? paperAccountId = null,
        [FromQuery] string? mode = null,
        CancellationToken ct = default)
    {
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        var resolvedMode = ResolveHistoryMode(settings.TradingMode, paperAccountId, mode);

        var result = await _history.BuildAsync(_db, resolvedMode, paperAccountId, limit, ct);

        return Ok(new
        {
            initialBalance = result.InitialBalance,
            actual = result.Actual.Select(p => new { time = p.Time, value = p.Value }),
            payoutRatios = result.PayoutRatios.Select(p => new
            {
                time = p.Time,
                ratio = p.Ratio,
                won = p.Won,
                tradeId = p.TradeId,
            }),
            mode = resolvedMode.ToString(),
            commissionPercent = settings.CommissionPercent,
            clobConfigured = _clob.IsConfigured,
        });
    }

    private static TradingMode ResolveHistoryMode(
        TradingMode engineMode,
        int? paperAccountId,
        string? modeQuery)
    {
        if (paperAccountId.HasValue)
        {
            return TradingMode.Paper;
        }

        if (!string.IsNullOrWhiteSpace(modeQuery)
            && Enum.TryParse<TradingMode>(modeQuery, ignoreCase: true, out var parsed))
        {
            return parsed;
        }

        return engineMode;
    }
}
