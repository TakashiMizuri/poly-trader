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
    public const int MaxCandles = 5000;

    /// <summary>
    /// Polymarket payout: buy <paramref name="stake"/> USD of shares at <paramref name="entryPrice"/>;
    /// win pays $1/share, loss pays $0. Entry fee is <paramref name="commissionPercent"/> of stake.
    /// </summary>
    public static (double Pnl, double Commission) ComputeBetPnl(
        bool won,
        double stake,
        double commissionPercent,
        double entryPrice = 0.5)
    {
        var price = entryPrice is > 0 and <= 1 ? entryPrice : 0.5;
        var commission = stake * (commissionPercent / 100);
        var shares = stake / price;
        var payout = won ? shares : 0;
        return (payout - stake - commission, commission);
    }

    public static double ComputeEntryShares(double stakeUsd, double entryPrice)
    {
        var price = entryPrice is > 0 and <= 1 ? entryPrice : 0.5;
        return stakeUsd / price;
    }

    /// <summary>
    /// Backtest: bet only when bos_flow signals at bar open (Polymarket 1:1 model).
    /// </summary>
    public static TrendBetSimulation? Simulate(
        IReadOnlyList<ChartCandle> candles,
        TrendBetStrategyParams? parameters = null)
    {
        if (candles.Count == 0)
        {
            return null;
        }

        var p = parameters ?? TrendBetStrategyParams.Default;
        var signals = BosFlowSignals.Generate(candles, p.BosFlow);
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
            if (!signals.EntryBar[i] || signals.Side[i] is null)
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
            var trend = signals.Side[i]!.Value;
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

    /// <param name="nextBar">
    /// Optional forming bar at <c>closedCandle.Time + interval</c> (real open[i] from Binance).
    /// Decision still uses only bars [0..i-1] per STRATEGY.md; open[i] is allowed for timestamp.
    /// </param>
    public static CandleCloseStrategyResult? ProcessCandleClose(
        ChartCandle closedCandle,
        IReadOnlyList<ChartCandle> closedCandles,
        long candleIntervalSeconds,
        TrendBetStrategyParams? parameters = null,
        ChartCandle? nextBar = null)
    {
        if (closedCandles.Count == 0)
        {
            return null;
        }

        var closedIndexInInput = -1;
        for (var i = closedCandles.Count - 1; i >= 0; i--)
        {
            if (closedCandles[i].Time == closedCandle.Time)
            {
                closedIndexInInput = i;
                break;
            }
        }

        if (closedIndexInInput < 0)
        {
            return null;
        }

        // Live buffer may already include the next forming bar after the close event.
        var throughClose = closedCandles.Take(closedIndexInInput + 1).ToList();
        var window = throughClose.Count <= MaxCandles
            ? throughClose
            : throughClose.Skip(throughClose.Count - MaxCandles).ToList();

        var p = parameters ?? TrendBetStrategyParams.Default;
        var closedIndex = window.Count - 1;
        if (window[closedIndex].Time != closedCandle.Time)
        {
            return null;
        }

        TrendBetSettlement? settlement = null;
        var betAtOpen = BetResolver.ResolveAtOpen(closedIndex, window, p.BosFlow);

        if (betAtOpen != null)
        {
            var balanceAtOpen = ComputeBalanceAtBarOpen(window, closedIndex, p);
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
            var nextOpenTime = closedCandle.Time + candleIntervalSeconds;
            var nextIndex = window.Count;
            var extended = window.ToList();
            if (nextBar != null && nextBar.Time == nextOpenTime)
            {
                // Real bar open from exchange (allowed: open[i] only; gates use closed = i-1).
                extended.Add(new ChartCandle
                {
                    Time = nextBar.Time,
                    Open = nextBar.Open,
                    High = nextBar.Open,
                    Low = nextBar.Open,
                    Close = nextBar.Open,
                });
            }
            else
            {
                var anchor = window[^1];
                extended.Add(new ChartCandle
                {
                    Time = nextOpenTime,
                    Open = anchor.Close,
                    High = anchor.Close,
                    Low = anchor.Close,
                    Close = anchor.Close,
                });
            }

            var signals = BosFlowSignals.Generate(extended, p.BosFlow);
            if (nextIndex < signals.EntryBar.Count
                && signals.EntryBar[nextIndex]
                && signals.Side[nextIndex] is { } side)
            {
                entry = new TrendBetEntrySignal
                {
                    TargetCandleTime = nextOpenTime,
                    Trend = side,
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
        int barIndex,
        TrendBetStrategyParams parameters)
    {
        var signals = BosFlowSignals.Generate(candles, parameters.BosFlow);
        var balance = parameters.StartBalance;
        for (var i = 0; i < barIndex; i++)
        {
            if (!signals.EntryBar[i] || signals.Side[i] is null)
            {
                continue;
            }

            var stake = BetStakeResolver.ResolveForBalance(balance, parameters);
            if (stake == null)
            {
                continue;
            }

            var (pnl, _) = ComputeBetPnl(
                IsBetWon(signals.Side[i]!.Value, candles[i]),
                stake.Value,
                parameters.CommissionPercent);
            balance = SafeBetStake.ClampBalanceAfterBet(balance + pnl);
        }

        return balance;
    }

    public static bool IsBetWon(MarketTrend trend, ChartCandle candle) =>
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
