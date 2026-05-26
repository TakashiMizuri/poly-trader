using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure;

internal static class TradeRecording
{
    public static void ApplyStakeSnapshot(
        TradeEntity trade,
        double balanceAtOpen,
        EngineSettingsEntity settings)
    {
        trade.StakeBalanceUsd = balanceAtOpen;
        trade.BetStakeMode = settings.BetStakeMode;
        if (settings.BetStakeMode == BetStakeMode.Percent)
        {
            trade.BetStakePercent = settings.BetStakePercent;
            trade.BetStakeFixedUsd = null;
        }
        else
        {
            trade.BetStakeFixedUsd = settings.BetStakeUsd;
            trade.BetStakePercent = null;
        }
    }

    public static void ApplySettlement(
        TradeEntity trade,
        bool won,
        double commissionPercent)
    {
        trade.Won = won;
        var (pnl, _) = TrendBetStrategySimulator.ComputeBetPnl(
            won,
            trade.StakeUsd,
            commissionPercent,
            trade.EntryPrice);
        trade.PnlUsd = pnl;
        trade.WinPayoutRatio = TrendBetStrategySimulator.ComputePayoutRatio(pnl, trade.StakeUsd);
    }

    public static double? ResolvePayoutRatio(TradeEntity trade)
    {
        if (trade.StakeUsd <= 0 || trade.PnlUsd is not double pnl)
        {
            return null;
        }

        return TrendBetStrategySimulator.ComputePayoutRatio(pnl, trade.StakeUsd);
    }
}
