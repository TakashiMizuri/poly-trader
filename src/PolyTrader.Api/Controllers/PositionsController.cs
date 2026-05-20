using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Infrastructure.Data;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class PositionsController : ControllerBase
{
    private readonly PolyTraderDbContext _db;

    public PositionsController(PolyTraderDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> List(CancellationToken ct)
    {
        var positions = await _db.Positions
            .AsNoTracking()
            .Include(p => p.Market)
            .OrderByDescending(p => p.OpenedAt)
            .Take(100)
            .ToListAsync(ct);

        return Ok(positions.Select(p => new
        {
            p.Id,
            p.Side,
            p.SizeUsd,
            p.AvgPrice,
            mode = p.Mode.ToString(),
            p.IsOpen,
            p.OpenedAt,
            p.ClosedAt,
            market = p.Market == null ? null : new { p.Market.Title, p.Market.Slug }
        }));
    }
}
