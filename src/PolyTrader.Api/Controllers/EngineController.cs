using Microsoft.AspNetCore.Mvc;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class EngineController : ControllerBase
{
    private readonly IEngineSettingsService _engine;
    private readonly IPolymarketClobService _clob;

    public EngineController(IEngineSettingsService engine, IPolymarketClobService clob)
    {
        _engine = engine;
        _clob = clob;
    }

    [HttpGet("live-status")]
    public async Task<ActionResult<LiveStatusDto>> LiveStatus(CancellationToken ct)
    {
        var balance = _clob.IsConfigured
            ? await _clob.GetCollateralBalanceAsync(ct)
            : null;

        return Ok(new LiveStatusDto(
            _clob.IsConfigured,
            balance,
            balance is >= SafeBetStake.MinBetStake));
    }

    [HttpGet]
    public async Task<ActionResult<EngineSettingsDto>> Get(CancellationToken ct)
    {
        var s = await _engine.GetAsync(ct);
        return Ok(MapDto(s));
    }

    [HttpPut]
    public async Task<ActionResult<EngineSettingsDto>> Update(
        [FromBody] UpdateEngineSettingsRequest req,
        CancellationToken ct)
    {
        var result = await _engine.UpdateAsync(MapCommand(req), ct);
        if (!result.Success)
        {
            return BadRequest(result.ErrorMessage);
        }

        return Ok(MapDto(result.Settings!));
    }

    private static UpdateEngineSettingsCommand MapCommand(UpdateEngineSettingsRequest req) =>
        new(
            req.TradingMode,
            req.ActivePaperAccountId,
            req.IsRunning,
            req.BetStakeMode,
            req.BetStakeUsd,
            req.BetStakePercent,
            req.MaxBetStakeUsd,
            req.ClearMaxBetStakeUsd,
            req.CommissionPercent,
            req.AutoRedeemEnabled);

    private static EngineSettingsDto MapDto(EngineSettingsSnapshot s) =>
        new(
            s.TradingMode,
            s.IsRunning,
            s.BetStakeMode,
            s.BetStakeUsd,
            s.BetStakePercent,
            s.MaxBetStakeUsd,
            s.ActiveBetStakeMode,
            s.ActiveBetStakeUsd,
            s.ActiveBetStakePercent,
            s.ActiveMaxBetStakeUsd,
            s.HasPendingStakeChanges,
            s.CommissionPercent,
            s.ActivePaperAccountId,
            s.ActivePaperAccountName,
            s.ActivePaperBalance,
            s.AutoRedeemEnabled,
            s.UpdatedAt);

    public sealed record EngineSettingsDto(
        string TradingMode,
        bool IsRunning,
        string BetStakeMode,
        double BetStakeUsd,
        double BetStakePercent,
        double? MaxBetStakeUsd,
        string ActiveBetStakeMode,
        double ActiveBetStakeUsd,
        double ActiveBetStakePercent,
        double? ActiveMaxBetStakeUsd,
        bool HasPendingStakeChanges,
        double CommissionPercent,
        int? ActivePaperAccountId,
        string? ActivePaperAccountName,
        double? ActivePaperBalance,
        bool AutoRedeemEnabled,
        DateTime UpdatedAt);

    public sealed record UpdateEngineSettingsRequest(
        string? TradingMode,
        int? ActivePaperAccountId,
        bool? IsRunning,
        string? BetStakeMode,
        double? BetStakeUsd,
        double? BetStakePercent,
        double? MaxBetStakeUsd,
        bool? ClearMaxBetStakeUsd,
        double? CommissionPercent,
        bool? AutoRedeemEnabled);

    public sealed record LiveStatusDto(
        bool ClobConfigured,
        double? LiveBalanceUsd,
        bool CanTrade);
}
