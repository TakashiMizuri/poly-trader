import { GAMMA_API_BASE } from "./constants.js";

export type PolymarketPublicProfile = {
  name?: string | null;
  pseudonym?: string | null;
  displayUsernamePublic?: boolean | null;
  profileImage?: string | null;
  proxyWallet?: string | null;
};

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isValidEthAddress(address: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(normalizeAddress(address));
}

/** User-facing nickname: public display name when allowed, otherwise pseudonym. */
export function resolvePolymarketDisplayName(profile: PolymarketPublicProfile): string | null {
  const name = profile.name?.trim();
  const pseudonym = profile.pseudonym?.trim();
  if (profile.displayUsernamePublic !== false && name) return name;
  if (pseudonym) return pseudonym;
  if (name) return name;
  return null;
}

export async function fetchPolymarketPublicProfile(
  address: string
): Promise<PolymarketPublicProfile | null> {
  const normalized = normalizeAddress(address);
  if (!isValidEthAddress(normalized)) {
    throw new Error("Invalid wallet address");
  }

  const url = new URL(`${GAMMA_API_BASE}/public-profile`);
  url.searchParams.set("address", normalized);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Polymarket profile HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as PolymarketPublicProfile;
}
