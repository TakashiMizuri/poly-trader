using Microsoft.AspNetCore.Mvc;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/logs")]
public sealed class LogsController : ControllerBase
{
    private readonly ILogExportService _export;

    public LogsController(ILogExportService export)
    {
        _export = export;
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(CancellationToken ct)
    {
        try
        {
            var result = await _export.CreateExportAsync(ct);
            Response.RegisterForDispose(result.Stream);
            return File(result.Stream, "application/zip", result.FileName);
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }
}
