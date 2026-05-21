namespace PolyTrader.Infrastructure.Polymarket;

internal static class PolymarketCtfConstants
{
    public const string CtfContractAddress = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
    public const string UsdcEAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    public const string DefaultPolygonRpc = "https://polygon-rpc.com";
    public const int PolygonChainId = 137;

    public static readonly byte[] ParentCollectionId = new byte[32];

    public static readonly System.Numerics.BigInteger[] BinaryIndexSets =
    [
        System.Numerics.BigInteger.One,
        new(2),
    ];
}
