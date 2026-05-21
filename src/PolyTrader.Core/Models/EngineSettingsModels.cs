namespace PolyTrader.Core.Models;

public sealed record EngineSettingsSnapshot(
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

public sealed record UpdateEngineSettingsCommand(
    string? TradingMode = null,
    int? ActivePaperAccountId = null,
    bool? IsRunning = null,
    string? BetStakeMode = null,
    double? BetStakeUsd = null,
    double? BetStakePercent = null,
    double? MaxBetStakeUsd = null,
    bool? ClearMaxBetStakeUsd = null,
    double? CommissionPercent = null,
    bool? AutoRedeemEnabled = null);

public sealed record EngineSettingsUpdateResult(
    bool Success,
    EngineSettingsSnapshot? Settings,
    string? ErrorMessage);
