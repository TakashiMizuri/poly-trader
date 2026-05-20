using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure;

public static class EngineStakeSettings
{
    public static void SyncPendingFromActive(EngineSettingsEntity s)
    {
        s.PendingBetStakeMode = s.BetStakeMode;
        s.PendingBetStakeUsd = s.BetStakeUsd;
        s.PendingBetStakePercent = s.BetStakePercent;
        s.PendingMaxBetStakeUsd = s.MaxBetStakeUsd;
    }

    public static void ApplyPendingToActive(EngineSettingsEntity s)
    {
        s.BetStakeMode = s.PendingBetStakeMode;
        s.BetStakeUsd = s.PendingBetStakeUsd;
        s.BetStakePercent = s.PendingBetStakePercent;
        s.MaxBetStakeUsd = s.PendingMaxBetStakeUsd;
    }

    public static bool HasPendingChanges(EngineSettingsEntity s) =>
        s.PendingBetStakeMode != s.BetStakeMode
        || Math.Abs(s.PendingBetStakeUsd - s.BetStakeUsd) > 1e-9
        || Math.Abs(s.PendingBetStakePercent - s.BetStakePercent) > 1e-9
        || s.PendingMaxBetStakeUsd != s.MaxBetStakeUsd;

    public static void ApplyPendingPatch(
        EngineSettingsEntity s,
        BetStakeMode? mode,
        double? betStakeUsd,
        double? betStakePercent,
        double? maxBetStakeUsd,
        bool clearMaxBetStakeUsd)
    {
        if (mode is not null)
        {
            s.PendingBetStakeMode = mode.Value;
        }

        if (betStakeUsd.HasValue)
        {
            s.PendingBetStakeUsd = betStakeUsd.Value;
        }

        if (betStakePercent.HasValue)
        {
            s.PendingBetStakePercent = betStakePercent.Value;
        }

        if (maxBetStakeUsd.HasValue)
        {
            var max = maxBetStakeUsd.Value;
            s.PendingMaxBetStakeUsd = max > 0 ? max : null;
        }
        else if (clearMaxBetStakeUsd)
        {
            s.PendingMaxBetStakeUsd = null;
        }
    }
}
