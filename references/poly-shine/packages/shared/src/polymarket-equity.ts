import { unzipSync } from "fflate";
import { mapWithConcurrency } from "./async-pool.js";
import { withFetchRetry } from "./fetch-retry.js";

const SNAPSHOT_URL = "https://data-api.polymarket.com/v1/accounting/snapshot";
const CACHE_TTL_MS = 12_000;
/** Polymarket snapshot ZIP downloads are heavy; limit parallel fetches. */
const SNAPSHOT_CONCURRENCY = 2;

export type PolymarketEquity = {
  cashBalance: number;
  positionsValue: number;
  equity: number;
  valuationTime: string;
};

type CacheEntry = { equity: PolymarketEquity; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<PolymarketEquity>>();

let snapshotActive = 0;
const snapshotWaiters: Array<() => void> = [];

function acquireSnapshotSlot(): Promise<void> {
  if (snapshotActive < SNAPSHOT_CONCURRENCY) {
    snapshotActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    snapshotWaiters.push(() => {
      snapshotActive += 1;
      resolve();
    });
  });
}

function releaseSnapshotSlot() {
  snapshotActive -= 1;
  const next = snapshotWaiters.shift();
  if (next) next();
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function isValidAddress(address: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(normalizeAddress(address));
}

function parseEquityCsv(text: string): PolymarketEquity {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("No Polymarket balance data for this wallet");
  }

  const cols = lines[1]!.split(",");
  if (cols.length < 4) throw new Error(`Unexpected equity.csv format: ${lines[1]}`);

  return {
    cashBalance: Number(cols[0]),
    positionsValue: Number(cols[1]),
    equity: Number(cols[2]),
    valuationTime: cols[3]!,
  };
}

async function downloadEquitySnapshot(user: string): Promise<PolymarketEquity> {
  const url = `${SNAPSHOT_URL}?user=${encodeURIComponent(user)}`;
  const res = await withFetchRetry(
    () => fetch(url, { signal: AbortSignal.timeout(90_000) }),
    { attempts: 3, baseDelayMs: 500 }
  );
  if (!res.ok) throw new Error(`Polymarket snapshot HTTP ${res.status}`);

  const zipBytes = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipBytes);
  const csvBytes = files["equity.csv"];
  if (!csvBytes) throw new Error("equity.csv missing from snapshot archive");

  return parseEquityCsv(new TextDecoder().decode(csvBytes));
}

async function loadEquityUncached(user: string): Promise<PolymarketEquity> {
  await acquireSnapshotSlot();
  try {
    return await downloadEquitySnapshot(user);
  } finally {
    releaseSnapshotSlot();
  }
}

export async function fetchPolymarketEquity(userAddress: string): Promise<PolymarketEquity> {
  const user = normalizeAddress(userAddress);
  if (!isValidAddress(user)) throw new Error("Invalid Ethereum address");

  const hit = cache.get(user);
  if (hit && hit.expiresAt > Date.now()) return hit.equity;

  let pending = inFlight.get(user);
  if (!pending) {
    pending = (async () => {
      try {
        const equity = await loadEquityUncached(user);
        cache.set(user, { equity, expiresAt: Date.now() + CACHE_TTL_MS });
        return equity;
      } finally {
        if (inFlight.get(user) === pending) inFlight.delete(user);
      }
    })();
    inFlight.set(user, pending);
  }
  return pending;
}

export async function fetchPolymarketEquityBatch(
  addresses: string[]
): Promise<Record<string, PolymarketEquity | { error: string }>> {
  const unique = [...new Set(addresses.map(normalizeAddress))];
  const out: Record<string, PolymarketEquity | { error: string }> = {};

  await mapWithConcurrency(unique, SNAPSHOT_CONCURRENCY, async (addr) => {
    try {
      out[addr] = await fetchPolymarketEquity(addr);
    } catch (e) {
      out[addr] = { error: e instanceof Error ? e.message : "Failed to load balance" };
    }
  });

  return out;
}
