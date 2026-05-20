import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { balancesSnapshots } from "@poly-shine/db";

const SCOPE = "daily_equity_baseline";

export function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadDayStartEquity(
  db: Db,
  followerAddress: string,
  dayKey: string
): Promise<number | null> {
  const rows = await db
    .select({ balanceUsd: balancesSnapshots.balanceUsd })
    .from(balancesSnapshots)
    .where(
      and(
        eq(balancesSnapshots.scope, SCOPE),
        eq(balancesSnapshots.refAddress, followerAddress.toLowerCase()),
        eq(balancesSnapshots.snapshotAt, dayKey)
      )
    )
    .orderBy(desc(balancesSnapshots.snapshotAt))
    .limit(1);
  const raw = rows[0]?.balanceUsd;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function saveDayStartEquity(
  db: Db,
  followerAddress: string,
  dayKey: string,
  equity: number
): Promise<void> {
  await db.insert(balancesSnapshots).values({
    scope: SCOPE,
    refAddress: followerAddress.toLowerCase(),
    balanceUsd: String(equity),
    snapshotAt: dayKey,
    raw: { equity, dayKey },
  });
}
