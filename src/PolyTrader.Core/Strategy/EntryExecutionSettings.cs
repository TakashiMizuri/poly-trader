namespace PolyTrader.Core.Strategy;

/// <summary>Runtime entry execution limits (patience window, price band).</summary>
public sealed class EntryExecutionSettings
{
    public const int DefaultMaxWaitSeconds = 60;
    public const int MaxWaitSecondsCap = 180;
    public const int WindowEndSafetyMarginSeconds = 30;

    /// <summary>Do not start patience when remaining window wait is below this (avoids fake 1s waits).</summary>
    public const int MinPatienceWaitSeconds = 5;

    public int MaxWaitSeconds { get; init; } = DefaultMaxWaitSeconds;

    public double PatienceMaxEntryPrice { get; init; } = EntryPriceRules.MaxEntryPrice;

    public static EntryExecutionSettings Default { get; } = new();

    public TimeSpan PatienceWaitDuration => TimeSpan.FromSeconds(MaxWaitSeconds);

    /// <summary>Patience wait capped by remaining time before 5m window end.</summary>
    public TimeSpan ResolvePatienceWait(long windowStartMs, long? windowEndMs = null)
    {
        var configured = PatienceWaitDuration;
        if (windowEndMs is null || windowEndMs <= windowStartMs)
        {
            windowEndMs = windowStartMs + 300_000L;
        }

        var safetyMs = WindowEndSafetyMarginSeconds * 1000L;
        var deadlineMs = windowEndMs.Value - safetyMs;
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var remainingMs = deadlineMs - nowMs;
        if (remainingMs <= 0)
        {
            return TimeSpan.FromSeconds(1);
        }

        var waitMs = Math.Min((long)configured.TotalMilliseconds, remainingMs);
        return TimeSpan.FromMilliseconds(Math.Max(1000, waitMs));
    }

    public static int ClampMaxWaitSeconds(int seconds) =>
        Math.Clamp(seconds, 1, MaxWaitSecondsCap);
}
