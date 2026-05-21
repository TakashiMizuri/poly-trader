using System.Numerics;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Contracts;

namespace PolyTrader.Infrastructure.Polymarket.Ctf;

[Function("redeemPositions")]
public sealed class RedeemPositionsFunction : FunctionMessage
{
    [Parameter("address", "collateralToken", 1)]
    public string CollateralToken { get; set; } = PolymarketCtfConstants.UsdcEAddress;

    [Parameter("bytes32", "parentCollectionId", 2)]
    public byte[] ParentCollectionId { get; set; } = PolymarketCtfConstants.ParentCollectionId;

    [Parameter("bytes32", "conditionId", 3)]
    public byte[] ConditionId { get; set; } = [];

    [Parameter("uint256[]", "indexSets", 4)]
    public List<BigInteger> IndexSets { get; set; } =
        PolymarketCtfConstants.BinaryIndexSets.ToList();
}
