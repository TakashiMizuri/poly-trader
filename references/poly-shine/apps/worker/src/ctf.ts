import { GAMMA_API_BASE } from "@poly-shine/shared";
import { createWalletClient, http, type Hex } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/** Polymarket Conditional Tokens (CTF) on Polygon. */
export const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;

/** Bridged USDC.e — CTF collateral on Polymarket. */
export const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

const BINARY_PARTITION = [1n, 2n] as const;
const INDEX_SETS = [1n, 2n] as const;

const ctfAbi = [
  {
    type: "function",
    name: "mergePositions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "partition", type: "uint256[]" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "splitPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "partition", type: "uint256[]" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "redeemPositions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

const conditionTokenCache = new Map<string, string[]>();

export function setsToCollateralAmount(sets: number): bigint {
  const units = Math.floor(sets * 1e6);
  if (units <= 0) return 0n;
  return BigInt(units);
}

export async function fetchConditionTokenIds(conditionId: string): Promise<string[] | null> {
  const key = conditionId.toLowerCase();
  const cached = conditionTokenCache.get(key);
  if (cached) return cached;

  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set("condition_ids", conditionId);
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  const markets = (await res.json()) as Array<{ clobTokenIds?: string }>;
  const market = markets[0];
  if (!market?.clobTokenIds) return null;
  let ids: string[];
  try {
    ids = JSON.parse(market.clobTokenIds) as string[];
  } catch {
    return null;
  }
  if (!Array.isArray(ids) || ids.length < 2) return null;
  conditionTokenCache.set(key, ids);
  return ids;
}

function getCtfWalletClient() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.startsWith("0x")) return null;
  const account = privateKeyToAccount(pk as Hex);
  return createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });
}

export async function executeMergePositions(
  conditionId: string,
  sets: number
): Promise<{ txHash: string } | { error: string }> {
  const client = getCtfWalletClient();
  if (!client) return { error: "missing_trading_client" };
  const amount = setsToCollateralAmount(sets);
  if (amount <= 0n) return { error: "merge_amount_too_small" };
  try {
    const hash = await client.writeContract({
      address: CTF_ADDRESS,
      abi: ctfAbi,
      functionName: "mergePositions",
      args: [USDC_E_ADDRESS, PARENT_COLLECTION_ID, conditionId as Hex, [...BINARY_PARTITION], amount],
    });
    return { txHash: hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 500) };
  }
}

export async function executeSplitPosition(
  conditionId: string,
  sets: number
): Promise<{ txHash: string } | { error: string }> {
  const client = getCtfWalletClient();
  if (!client) return { error: "missing_trading_client" };
  const amount = setsToCollateralAmount(sets);
  if (amount <= 0n) return { error: "split_amount_too_small" };
  try {
    const hash = await client.writeContract({
      address: CTF_ADDRESS,
      abi: ctfAbi,
      functionName: "splitPosition",
      args: [USDC_E_ADDRESS, PARENT_COLLECTION_ID, conditionId as Hex, [...BINARY_PARTITION], amount],
    });
    return { txHash: hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 500) };
  }
}

export async function executeRedeemPositions(
  conditionId: string
): Promise<{ txHash: string } | { error: string }> {
  const client = getCtfWalletClient();
  if (!client) return { error: "missing_trading_client" };
  try {
    const hash = await client.writeContract({
      address: CTF_ADDRESS,
      abi: ctfAbi,
      functionName: "redeemPositions",
      args: [USDC_E_ADDRESS, PARENT_COLLECTION_ID, conditionId as Hex, [...INDEX_SETS]],
    });
    return { txHash: hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 500) };
  }
}

/** Cap merge sets by equal holdings on both outcome tokens. */
export function capMergeSetsByBalances(
  sets: number,
  balances: Array<number | null>
): { sets: number; skipReason?: string } {
  const finite = balances.filter((b): b is number => b != null && Number.isFinite(b));
  if (finite.length < 2) return { sets: 0, skipReason: "merge_pair_balance_unavailable" };
  const cap = Math.min(...finite);
  if (cap <= 0) return { sets: 0, skipReason: "insufficient_merge_pair" };
  return { sets: Math.min(sets, cap) };
}
