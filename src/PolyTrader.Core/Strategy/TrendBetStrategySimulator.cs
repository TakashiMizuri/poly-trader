using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

public sealed class TrendBet
{
    public long Time { get; init; }
    public MarketTrend Trend { get; init; }
    public double Open { get; init; }
    public double High { get; init; }
    public double Low { get; init; }
    public double Close { get; init; }
    public bool Won { get; init; }
    public double Pnl { get; init; }
    public double Stake { get; init; }
    public double Commission { get; init; }
    public double BalanceAfter { get; init; }
}

public sealed class TrendSideStats
{
    public int Total { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public double NetPnl { get; set; }
}

public sealed class EquityPoint
{
    public long Time { get; init; }
    public double Value { get; init; }
}

/// <summary>Entry for the next candle, decided when the previous candle closes.</summary>
public sealed class TrendBetEntrySignal
{
    public long TargetCandleTime { get; init; }
    public MarketTrend Trend { get; init; }
}

/// <summary>Outcome when a candle closes — same rules as chart backtest and paper/live engine.</summary>
public sealed class TrendBetSettlement
{
    public long CandleTime { get; init; }
    public bool Won { get; init; }
    public double Pnl { get; init; }
    public double Commission { get; init; }
}

public sealed class CandleCloseStrategyResult
{
    public TrendBetSettlement? Settlement { get; init; }
    public TrendBetEntrySignal? Entry { get; init; }
}

public sealed class TrendBetSimulation
{
    public double StartBalance { get; init; }
    public double EndBalance { get; init; }
    public double NetPnl { get; init; }
    public int TotalBets { get; init; }
    public int Wins { get; init; }
    public int Losses { get; init; }
    public double WinRate { get; init; }
    public TrendSideStats LongStats { get; init; } = new();
    public TrendSideStats ShortStats { get; init; } = new();
    public double MaxDrawdown { get; init; }
    public double MaxDrawdownPct { get; init; }
    public int SkippedBars { get; init; }
    public double MinBalance { get; init; }
    public IReadOnlyList<TrendBet> Bets { get; init; } = [];
    public IReadOnlyList<EquityPoint> EquityCurve { get; init; } = [];
    public TrendBetStrategyParams Params { get; init; } = TrendBetStrategyParams.Default;
}

public static class TrendBetStrategySimulator
{
    public static (double Pnl, double Commission) ComputeBetPnl(
        bool won,
        double stake,
        double commissionPercent)
    {
        var commission = stake * (commissionPercent / 100);
        var gross = won ? stake : -stake;
        return (gross - commission, commission);
    }

    /// <summary>
    /// Backtest: bet only when strategy signals at bar open (exhaustion fade by default).
    /// </summary>
    public static TrendBetSimulation? Simulate(
        IReadOnlyList<ChartCandle> candles,
        IReadOnlyList<MarketTrend> trendAtOpen,
        IReadOnlyList<bool> bosFlipAt,
        TrendBetStrategyParams? parameters = null)
    {
        if (candles.Count == 0 ||
            trendAtOpen.Count != candles.Count ||
            bosFlipAt.Count != candles.Count)
        {
            return null;
        }

        var p = parameters ?? TrendBetStrategyParams.Default;
        var bets = new List<TrendBet>();
        var equityCurve = new List<EquityPoint>();

        var balance = p.StartBalance;
        var peakBalance = p.StartBalance;
        var maxDrawdown = 0.0;
        var maxDrawdownPct = 0.0;
        var longStats = new TrendSideStats();
        var shortStats = new TrendSideStats();
        var skippedBars = 0;
        var minBalance = balance;

        for (var i = 0; i < candles.Count; i++)
        {
            var betSide = BetResolver.ResolveAtOpen(i, candles, trendAtOpen, p);
            if (betSide == null)
            {
                skippedBars++;
                continue;
            }

            var stake = BetStakeResolver.ResolveForBalance(balance, p);
            if (stake == null)
            {
                skippedBars++;
                continue;
            }

            var candle = candles[i];
            var trend = betSide.Value;
            var won = IsBetWon(trend, candle);
            var (pnl, commission) = ComputeBetPnl(won, stake.Value, p.CommissionPercent);
            balance = SafeBetStake.ClampBalanceAfterBet(balance + pnl);
            minBalance = Math.Min(minBalance, balance);

            var sideStats = trend == MarketTrend.Long ? longStats : shortStats;
            sideStats.Total++;
            sideStats.NetPnl += pnl;
            if (won) sideStats.Wins++;
            else sideStats.Losses++;

            bets.Add(new TrendBet
            {
                Time = candle.Time,
                Trend = trend,
                Open = candle.Open,
                High = candle.High,
                Low = candle.Low,
                Close = candle.Close,
                Won = won,
                Pnl = pnl,
                Stake = stake.Value,
                Commission = commission,
                BalanceAfter = balance
            });
            equityCurve.Add(new EquityPoint { Time = candle.Time, Value = balance });

            if (balance > peakBalance)
            {
                peakBalance = balance;
            }

            var drawdown = peakBalance - balance;
            if (drawdown > maxDrawdown)
            {
                maxDrawdown = drawdown;
                maxDrawdownPct = peakBalance > 0 ? drawdown / peakBalance * 100 : 0;
            }
        }

        var wins = bets.Count(b => b.Won);
        var losses = bets.Count - wins;

        return new TrendBetSimulation
        {
            StartBalance = p.StartBalance,
            EndBalance = balance,
            NetPnl = balance - p.StartBalance,
            TotalBets = bets.Count,
            Wins = wins,
            Losses = losses,
            WinRate = bets.Count > 0 ? (double)wins / bets.Count * 100 : 0,
            LongStats = longStats,
            ShortStats = shortStats,
            MaxDrawdown = maxDrawdown,
            MaxDrawdownPct = maxDrawdownPct,
            SkippedBars = skippedBars,
            MinBalance = minBalance,
            Bets = bets,
            EquityCurve = CoalesceEquityCurve(equityCurve),
            Params = p
        };
    }

    public static CandleCloseStrategyResult? ProcessCandleClose(
        ChartCandle closedCandle,
        IReadOnlyList<ChartCandle> closedCandles,
        long candleIntervalSeconds,
        TrendBetStrategyParams? parameters = null)
    {
        if (closedCandles.Count == 0)
        {
            return null;
        }

        var last = closedCandles[^1];
        if (last.Time != closedCandle.Time)
        {
            return null;
        }

        var window = closedCandles.Count <= BreakOfStructureAnalyzer.BosMaxCandles
            ? closedCandles
            : closedCandles.Skip(closedCandles.Count - BreakOfStructureAnalyzer.BosMaxCandles).ToList();

        var p = parameters ?? TrendBetStrategyParams.Default;
        var bos = BreakOfStructureAnalyzer.AnalyzeTrendAndBos(
            window,
            BreakOfStructureAnalyzer.OptionsFromParams(p));

        var closedIndex = bos.TrendAtOpen.Count - 1;

        TrendBetSettlement? settlement = null;
        var betAtOpen = BetResolver.ResolveAtOpen(
            closedIndex,
            window,
            bos.TrendAtOpen,
            p);

        if (betAtOpen != null)
        {
            var balanceAtOpen = ComputeBalanceAtBarOpen(
                window,
                bos.TrendAtOpen,
                closedIndex,
                p);
            var stake = BetStakeResolver.ResolveForBalance(balanceAtOpen, p)
                ?? BetStakeResolver.RequestedStake(balanceAtOpen, p);
            var won = IsBetWon(betAtOpen.Value, closedCandle);
            var (pnl, commission) = ComputeBetPnl(won, stake, p.CommissionPercent);
            settlement = new TrendBetSettlement
            {
                CandleTime = closedCandle.Time,
                Won = won,
                Pnl = pnl,
                Commission = commission
            };
        }

        TrendBetEntrySignal? entry = null;
        if (candleIntervalSeconds > 0)
        {
            var nextBet = BetResolver.ResolveForUpcomingBar(
                window,
                bos.TrendAtOpen,
                bos.TrendForNextOpen,
                p);

            if (nextBet != null)
            {
                entry = new TrendBetEntrySignal
                {
                    TargetCandleTime = closedCandle.Time + candleIntervalSeconds,
                    Trend = nextBet.Value
                };
            }
        }

        return new CandleCloseStrategyResult
        {
            Settlement = settlement,
            Entry = entry
        };
    }

    [Obsolete("Use ProcessCandleClose for live execution aligned with the chart backtest.")]
    public static TrendBet? GetLatestActionableBet(
        IReadOnlyList<ChartCandle> candles,
        TrendBetStrategyParams? parameters = null)
    {
        if (candles.Count == 0)
        {
            return null;
        }

        var interval = CandleIntervalHelper.InferIntervalSeconds(candles);
        var result = ProcessCandleClose(candles[^1], candles, interval, parameters);
        var entry = result?.Entry;
        if (entry == null)
        {
            return null;
        }

        return new TrendBet
        {
            Time = entry.TargetCandleTime,
            Trend = entry.Trend,
            Won = false,
            Pnl = 0,
            Stake = parameters?.BetStake ?? TrendBetStrategyParams.Default.BetStake,
            Commission = 0,
            BalanceAfter = 0
        };
    }

    private static double ComputeBalanceAtBarOpen(
        IReadOnlyList<ChartCandle> candles,
        IReadOnlyList<MarketTrend> trendAtOpen,
        int barIndex,
        TrendBetStrategyParams parameters)
    {
        var balance = parameters.StartBalance;
        for (var i = 0; i < barIndex; i++)
        {
            var betSide = BetResolver.ResolveAtOpen(i, candles, trendAtOpen, parameters);
            if (betSide == null) continue;
            var stake = BetStakeResolver.ResolveForBalance(balance, parameters);
            if (stake == null) continue;
            var (pnl, _) = ComputeBetPnl(
                IsBetWon(betSide.Value, candles[i]),
                stake.Value,
                parameters.CommissionPercent);
            balance = SafeBetStake.ClampBalanceAfterBet(balance + pnl);
        }

        return balance;
    }

    private static bool IsBetWon(MarketTrend trend, ChartCandle candle) =>
        trend == MarketTrend.Long
            ? candle.Close > candle.Open
            : candle.Close < candle.Open;

    private static IReadOnlyList<EquityPoint> CoalesceEquityCurve(List<EquityPoint> points)
    {
        if (points.Count == 0) return points;

        var sorted = points.OrderBy(p => p.Time).ToList();
        var result = new List<EquityPoint> { sorted[0] };

        for (var i = 1; i < sorted.Count; i++)
        {
            var point = sorted[i];
            var prev = result[^1];
            if (point.Time == prev.Time)
            {
                result[^1] = new EquityPoint { Time = point.Time, Value = point.Value };
                continue;
            }

            if (point.Time > prev.Time)
            {
                result.Add(point);
            }
        }

        return result;
    }
}
