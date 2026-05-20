namespace PolyTrader.Core.Models;

public sealed class ChartCandle
{
    public long Time { get; init; }
    public double Open { get; init; }
    public double High { get; init; }
    public double Low { get; init; }
    public double Close { get; init; }
}
