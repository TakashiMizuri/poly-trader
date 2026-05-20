using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Infrastructure.Data;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class MarketController : ControllerBase
{
    private readonly PolyTraderDbContext _db;

    public MarketController(PolyTraderDbContext db) => _db = db;

    [HttpGet("active")]
    public async Task<ActionResult<object>> Active(CancellationToken ct)
    {
        var market = await _db.Markets
            .AsNoTracking()
            .Where(m => m.IsActive)
            .OrderByDescending(m => m.UpdatedAt)
            .FirstOrDefaultAsync(ct);

        if (market == null)
        {
            return Ok(new { active = false });
        }

        var now = DateTime.UtcNow;
        var start = market.WindowStartUtc ?? now;
        var end = market.WindowEndUtc ?? start.AddMinutes(5);
        var totalMs = (end - start).TotalMilliseconds;
        var elapsedMs = Math.Clamp((now - start).TotalMilliseconds, 0, totalMs);
        var progress = totalMs > 0 ? elapsedMs / totalMs * 100 : 0;

        return Ok(new
        {
            active = true,
            market.Title,
            market.Slug,
            market.ConditionId,
            startAt = start,
            endAt = end,
            now,
            progressPercent = progress
        });
    }
}
