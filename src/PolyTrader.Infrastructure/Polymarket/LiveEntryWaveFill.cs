namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>One maker limit placement wave during live entry (post-only).</summary>
public sealed record LiveEntryWaveFill(
    int WaveIndex,
    double RequestedStakeUsd,
    double FilledStakeUsd,
    double? EntryPrice,
    string? OrderId)
{
    public double FillPercent =>
        RequestedStakeUsd > 0
            ? Math.Min(100, FilledStakeUsd / RequestedStakeUsd * 100)
            : 0;

    public string Label => WaveIndex switch
    {
        1 => "Attempt 1",
        2 => "Attempt 2 (remainder)",
        _ => $"Attempt {WaveIndex}",
    };
}
