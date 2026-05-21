namespace PolyTrader.Core.Strategy;

/// <summary>
/// Blend fade 2 — z-score mean-reversion on 5m closes
/// (1:1 with trading-cursor-models strategies/blend_fade2).
/// </summary>
public sealed class BlendFade2Config
{
    public int Lookback { get; init; } = 50;
    public int LookbackFast { get; init; } = 20;
    public double ZThreshold { get; init; } = 1.08;
    public double MinRangePct { get; init; } = 0.0026;
    public bool ZReversal { get; init; }
    public double ZFastMin { get; init; } = 0.64;
    public double RankConfirm { get; init; }
    public double ZMax { get; init; }
    public int? SessionUtcStart { get; init; }
    public int? SessionUtcEnd { get; init; }

    /// <summary>Same base as blend_fade blend_active; extras off.</summary>
    public static BlendFade2Config PresetActive() => new();

    /// <summary>Best PnL from search_tune (batch 2).</summary>
    public static BlendFade2Config PresetPnlMax() => new()
    {
        Lookback = 48,
        LookbackFast = 18,
        ZThreshold = 1.08,
        MinRangePct = 0.0026,
        ZFastMin = 0.60,
    };

    public static BlendFade2Config Default { get; } = PresetPnlMax();
}
