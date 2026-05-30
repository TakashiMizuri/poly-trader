using Microsoft.AspNetCore.Mvc;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/database")]
public sealed class DatabaseController : ControllerBase
{
    private readonly IDatabaseExportService _export;

    public DatabaseController(IDatabaseExportService export)
    {
        _export = export;
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(CancellationToken ct)
    {
        var result = await _export.CreateExportAsync(ct);
        Response.RegisterForDispose(result.Stream);
        return File(result.Stream, "application/zip", result.FileName);
    }
}
