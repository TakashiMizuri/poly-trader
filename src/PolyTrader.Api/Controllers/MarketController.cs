using Microsoft.AspNetCore.Mvc;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class MarketController : ControllerBase
{
    private readonly IPolymarketGammaService _gamma;

    public MarketController(IPolymarketGammaService gamma) => _gamma = gamma;

    [HttpGet("active")]
    public async Task<ActionResult<object>> Active(CancellationToken ct)
    {
        var windows = await _gamma.DiscoverBtc5mWindowsAsync(ct);
        if (windows.Current == null && windows.NextScheduled == null)
        {
            return Ok(new { active = false });
        }

        var now = DateTime.UtcNow;
        return Ok(new
        {
            active = windows.Current != null,
            current = MapWindow(windows.Current, now),
            next = MapWindow(windows.NextScheduled, now),
        });
    }

    private static object? MapWindow(MarketEntity? market, DateTime now)
    {
        if (market == null) return null;

        var start = market.WindowStartUtc ?? now;
        var end = market.WindowEndUtc ?? start.AddMinutes(5);
        var totalMs = (end - start).TotalMilliseconds;
        var windowStarted = now >= start;
        var elapsedMs = windowStarted
            ? Math.Clamp((now - start).TotalMilliseconds, 0, totalMs)
            : 0;
        var progress = windowStarted && totalMs > 0 ? elapsedMs / totalMs * 100 : 0;

        return new
        {
            market.Title,
            market.Slug,
            market.ConditionId,
            startAt = start,
            endAt = end,
            windowStarted,
            progressPercent = progress,
        };
    }
}
