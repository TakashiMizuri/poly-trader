import { and, eq } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { mirrorIntents, positionFollowState } from "@poly-shine/db";

/** Paper-only line memory must not carry into live trading. */
export async function resetShadowActiveLines(db: Db): Promise<number> {
  const rows = await db
    .update(positionFollowState)
    .set({
      state: "watching",
      abandonedReason: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(positionFollowState.state, "shadow_active"))
    .returning({ subscriptionId: positionFollowState.subscriptionId });
  return rows.length;
}

/** Re-queue mirrors cancelled when engine entered read_only. */
export async function reopenReadOnlySkippedIntents(db: Db): Promise<number> {
  const rows = await db
    .update(mirrorIntents)
    .set({
      status: "pending",
      skipReason: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(mirrorIntents.status, "skipped"), eq(mirrorIntents.skipReason, "read_only_mode")))
    .returning({ id: mirrorIntents.id });
  return rows.length;
}
