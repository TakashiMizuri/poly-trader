using System.Security.Cryptography;
using System.Text;

namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>
/// Stable key for a single live entry attempt (one per candle + outcome token).
/// Used to derive CLOB order salt so retries cannot double-place.
/// </summary>
public sealed record LiveEntryOrderKey(long CandleTimeMs, string TokenId)
{
    /// <summary>Maps to Polymarket <c>order.salt</c> (client order id). Same key → same signed order → duplicate rejected.</summary>
    public long DeriveClientOrderId()
    {
        var payload = $"polytrader-entry:{CandleTimeMs}:{TokenId}";
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(payload), hash);
        var value = BitConverter.ToUInt64(hash) & 0x7FFFFFFFFFFFFFFFL;
        return value == 0 ? 1 : (long)value;
    }
}
