using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/reset")]
public sealed class ResetController : ControllerBase
{
    private readonly GlobalResetService _reset;
    private readonly ITradingEventPublisher _publisher;
    private readonly ILogger<ResetController> _logger;

    public ResetController(
        GlobalResetService reset,
        ITradingEventPublisher publisher,
        ILogger<ResetController> logger)
    {
        _reset = reset;
        _publisher = publisher;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<GlobalResetResponse>> Post(CancellationToken ct)
    {
        _logger.LogWarning("POST /api/reset invoked");
        var result = await _reset.ResetAsync(ct);

        await _publisher.PublishEngineStatusAsync(result.IsRunning, result.TradingMode, ct);
        await _publisher.PublishBalanceUpdatedAsync(
            result.ActivePaperBalance,
            result.ActivePaperAccountId,
            ct);
        await _publisher.PublishMarketWindowUpdatedAsync(null, ct);

        return Ok(new GlobalResetResponse(
            result.TradingMode,
            result.IsRunning,
            result.ActivePaperAccountId,
            result.ActivePaperAccountName,
            result.ActivePaperBalance));
    }

    public sealed record GlobalResetResponse(
        string TradingMode,
        bool IsRunning,
        int ActivePaperAccountId,
        string ActivePaperAccountName,
        double ActivePaperBalance);
}
