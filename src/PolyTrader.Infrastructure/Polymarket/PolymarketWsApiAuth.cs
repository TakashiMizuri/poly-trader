namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>CLOB L2 credentials for authenticated user WebSocket.</summary>
public sealed record PolymarketWsApiAuth(string ApiKey, string Secret, string Passphrase);
