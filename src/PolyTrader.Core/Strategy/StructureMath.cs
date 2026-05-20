namespace PolyTrader.Core.Strategy;

/// <summary>EMA, RSI, and swing fractals (1:1 with trading-cursor-models strategies/lib/structure.py).</summary>
public static class StructureMath
{
    public static bool ConfirmSwingHigh(
        IReadOnlyList<double> highs,
        int i,
        int left,
        int right)
    {
        if (i < left || i + right >= highs.Count)
        {
            return false;
        }

        var pivot = highs[i];
        for (var j = i - left; j <= i + right; j++)
        {
            if (j != i && highs[j] >= pivot)
            {
                return false;
            }
        }

        return true;
    }

    public static bool ConfirmSwingLow(
        IReadOnlyList<double> lows,
        int i,
        int left,
        int right)
    {
        if (i < left || i + right >= lows.Count)
        {
            return false;
        }

        var pivot = lows[i];
        for (var j = i - left; j <= i + right; j++)
        {
            if (j != i && lows[j] <= pivot)
            {
                return false;
            }
        }

        return true;
    }

    public static double?[] Ema(IReadOnlyList<double> values, int period)
    {
        var n = values.Count;
        var outVals = new double?[n];
        if (period <= 0 || n < period)
        {
            return outVals;
        }

        var k = 2.0 / (period + 1);
        var seed = values.Take(period).Average();
        outVals[period - 1] = seed;
        var prev = seed;
        for (var i = period; i < n; i++)
        {
            prev = values[i] * k + prev * (1 - k);
            outVals[i] = prev;
        }

        return outVals;
    }

    public static double?[] Rsi(IReadOnlyList<double> closes, int period)
    {
        var n = closes.Count;
        var outVals = new double?[n];
        if (period <= 0 || n <= period)
        {
            return outVals;
        }

        var gains = 0.0;
        var losses = 0.0;
        for (var i = 1; i <= period; i++)
        {
            var d = closes[i] - closes[i - 1];
            if (d >= 0)
            {
                gains += d;
            }
            else
            {
                losses -= d;
            }
        }

        var avgGain = gains / period;
        var avgLoss = losses / period;
        if (avgLoss == 0)
        {
            outVals[period] = 100.0;
        }
        else
        {
            var rs = avgGain / avgLoss;
            outVals[period] = 100.0 - 100.0 / (1.0 + rs);
        }

        for (var i = period + 1; i < n; i++)
        {
            var d = closes[i] - closes[i - 1];
            var gain = d > 0 ? d : 0.0;
            var loss = d < 0 ? -d : 0.0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            if (avgLoss == 0)
            {
                outVals[i] = 100.0;
            }
            else
            {
                var rs = avgGain / avgLoss;
                outVals[i] = 100.0 - 100.0 / (1.0 + rs);
            }
        }

        return outVals;
    }
}
