using System.Security.Cryptography;
using System.Text;

namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>
/// Stable key for a single live entry attempt (one per candle + outcome token).
/// Used to derive CLOB order salt so retries cannot double-place.
/// </summary>
public sealed record LiveEntryOrderKey(long CandleTimeMs, string TokenId, int? PatienceAttempt = null)
{
    /// <summary>Maps to Polymarket <c>order.salt</c> (client order id). Same key → same signed order → duplicate rejected.</summary>
    /// <param name="waveIndex">0 = first wave; 1 = remainder wave (distinct salt).</param>
    public long DeriveClientOrderId(int waveIndex = 0)
    {
        string payload;
        if (PatienceAttempt is int p)
        {
            payload = waveIndex <= 0
                ? $"polytrader-entry:{CandleTimeMs}:{TokenId}:patience{p}"
                : $"polytrader-entry:{CandleTimeMs}:{TokenId}:patience{p}:wave{waveIndex}";
        }
        else
        {
            payload = waveIndex <= 0
                ? $"polytrader-entry:{CandleTimeMs}:{TokenId}"
                : $"polytrader-entry:{CandleTimeMs}:{TokenId}:wave{waveIndex}";
        }

        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(payload), hash);
        var value = BitConverter.ToUInt64(hash) & 0x7FFFFFFFFFFFFFFFL;
        return value == 0 ? 1 : (long)value;
    }
}
