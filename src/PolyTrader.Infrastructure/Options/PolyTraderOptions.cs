namespace PolyTrader.Infrastructure.Options;

public sealed class PolyTraderOptions
{
    public const string SectionName = "PolyTrader";

    public string ConnectionString { get; set; } = "Data Source=polytrader.db";
    public string? WebApiToken { get; set; }
    public string BinanceSymbol { get; set; } = "BTCUSDT";
    public string BinanceInterval { get; set; } = "5m";
    public int CandleHistoryLimit { get; set; } = 5000;
    public string? PolymarketPrivateKey { get; set; }
    public string? PolymarketFunderAddress { get; set; }
    public int PolymarketSignatureType { get; set; }
    public string GammaSearchQuery { get; set; } = "btc";
    public string BtcMarketSlugPrefix { get; set; } = "btc-updown-5m";
}
