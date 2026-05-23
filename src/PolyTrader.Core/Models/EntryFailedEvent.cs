namespace PolyTrader.Core.Models;

/// <summary>
/// Emitted when the engine attempted to open a position but could not (live order failure, balance, market, etc.).
/// </summary>
public sealed record EntryFailedEvent(
    long CandleTimeSec,
    string Mode,
    string SkipReason,
    string? Detail,
    string? MarketTitle,
    string? MarketSlug,
    string? Side = null,
    string? Trend = null,
    double? StakeUsd = null);
