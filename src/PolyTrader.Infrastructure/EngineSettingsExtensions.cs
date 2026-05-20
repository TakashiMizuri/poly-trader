using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure;

internal static class EngineSettingsExtensions
{
    public static TrendBetStrategyParams ToStrategyParams(
        this EngineSettingsEntity settings,
        double balance) =>
        TrendBetStrategyParams.ForLiveEngine(
            balance,
            settings.BetStakeMode,
            settings.BetStakeUsd,
            settings.BetStakePercent,
            settings.MaxBetStakeUsd,
            settings.CommissionPercent);
}
