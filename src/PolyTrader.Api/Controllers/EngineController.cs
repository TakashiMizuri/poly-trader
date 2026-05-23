using Microsoft.AspNetCore.Mvc;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Polymarket;
using PolyTrader.Infrastructure.Services;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class EngineController : ControllerBase
{
    private readonly IEngineSettingsService _engine;
    private readonly IPolymarketClobService _clob;
    private readonly LimitEntryPreviewService _limitPreview;

    public EngineController(
        IEngineSettingsService engine,
        IPolymarketClobService clob,
        LimitEntryPreviewService limitPreview)
    {
        _engine = engine;
        _clob = clob;
        _limitPreview = limitPreview;
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

    [HttpGet("limit-entry-preview")]
    public async Task<ActionResult<LimitEntryPreviewDto>> LimitEntryPreview(
        [FromQuery] string? tradingMode,
        [FromQuery] int? paperAccountId,
        [FromQuery] string? betStakeMode,
        [FromQuery] double? betStakeUsd,
        [FromQuery] double? betStakePercent,
        [FromQuery] double? maxBetStakeUsd,
        [FromQuery] bool clearMaxBetStakeUsd,
        [FromQuery] double? referenceBid,
        CancellationToken ct)
    {
        TradingMode? mode = null;
        if (!string.IsNullOrWhiteSpace(tradingMode)
            && Enum.TryParse<TradingMode>(tradingMode, true, out var parsedMode))
        {
            mode = parsedMode;
        }

        BetStakeMode? stakeMode = null;
        if (!string.IsNullOrWhiteSpace(betStakeMode)
            && Enum.TryParse<BetStakeMode>(betStakeMode, true, out var parsedStake))
        {
            stakeMode = parsedStake;
        }

        var preview = await _limitPreview.BuildAsync(
            new LimitEntryPreviewRequest(
                mode,
                paperAccountId,
                stakeMode,
                betStakeUsd,
                betStakePercent,
                maxBetStakeUsd,
                clearMaxBetStakeUsd,
                referenceBid),
            ct);

        return Ok(MapPreviewDto(preview));
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
            req.AutoRedeemEnabled,
            req.LiveEntryOrderMode);

    private static LimitEntryPreviewDto MapPreviewDto(LimitEntryPreview p) =>
        new(
            p.TradingMode,
            p.BalanceUsd,
            p.ReferenceBid,
            p.MarketReferenceBid,
            p.BidIsCustom,
            p.BidUnavailableReason,
            p.MinOrderShares,
            p.ClobMinStakeUsd,
            p.RequestedStakeUsd,
            p.EffectiveStakeUsd,
            p.CanTrade,
            p.WillBump,
            p.BlockReason,
            p.MinBalanceOneTradeUsd,
            p.MinBalanceConfiguredUsd,
            p.StakePercent,
            p.StakeUsd,
            p.MaxBetStakeUsd);

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
            s.LiveEntryOrderMode,
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
        string LiveEntryOrderMode,
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
        bool? AutoRedeemEnabled,
        string? LiveEntryOrderMode);

    public sealed record LiveStatusDto(
        bool ClobConfigured,
        double? LiveBalanceUsd,
        bool CanTrade);

    public sealed record LimitEntryPreviewDto(
        string TradingMode,
        double? BalanceUsd,
        double? ReferenceBid,
        double? MarketReferenceBid,
        bool BidIsCustom,
        string? BidUnavailableReason,
        decimal MinOrderShares,
        double? ClobMinStakeUsd,
        double RequestedStakeUsd,
        double EffectiveStakeUsd,
        bool CanTrade,
        bool WillBump,
        string? BlockReason,
        double? MinBalanceOneTradeUsd,
        double? MinBalanceConfiguredUsd,
        double? StakePercent,
        double? StakeUsd,
        double? MaxBetStakeUsd);
}
