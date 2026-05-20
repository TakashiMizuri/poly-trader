import {
  Chain,
  ClobClient,
  SignatureTypeV2,
  AssetType,
} from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { CLOB_HOST } from "@poly-shine/shared";

let cached: ClobClient | null = null;

function parseSignatureType(): SignatureTypeV2 {
  const n = Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "0");
  if (n === 1) return SignatureTypeV2.POLY_PROXY;
  if (n === 2) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (n === 3) return SignatureTypeV2.POLY_1271;
  return SignatureTypeV2.EOA;
}

/** Proxy/funder wallet when set; otherwise the EOA derived from POLYMARKET_PRIVATE_KEY. */
export function getFollowerWalletAddress(): string | null {
  const funder = process.env.POLYMARKET_FUNDER_ADDRESS;
  if (funder?.startsWith("0x")) return funder.toLowerCase();
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.startsWith("0x")) return null;
  return privateKeyToAccount(pk as `0x${string}`).address.toLowerCase();
}

export async function getTradingClient(): Promise<ClobClient | null> {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk || !pk.startsWith("0x")) {
    return null;
  }
  if (cached) return cached;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const signer = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });
  const base = new ClobClient({
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer,
  });
  const creds = await base.createOrDeriveApiKey();
  const funder = process.env.POLYMARKET_FUNDER_ADDRESS;
  cached = new ClobClient({
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer,
    creds,
    signatureType: parseSignatureType(),
    funderAddress: funder && funder.startsWith("0x") ? funder : undefined,
  });
  return cached;
}

export async function fetchCollateralBalance(client: ClobClient): Promise<number | null> {
  try {
    const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const raw = bal.balance;
    if (raw == null) return null;
    return Number(raw) / 1e6;
  } catch {
    return null;
  }
}
