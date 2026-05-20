import {
  auditLog,
  balancesSnapshots,
  engineState,
  executions,
  leaderEvents,
  mirrorIntents,
  pnlRollups,
  positionFollowState,
  subscriptions,
} from "@poly-shine/db";
import { eq } from "drizzle-orm";
import { audit } from "./audit.js";
import { db } from "./db.js";

export async function runGlobalReset() {
  await db.delete(executions);
  await db.delete(mirrorIntents);
  await db.delete(positionFollowState);
  await db.delete(leaderEvents);
  await db.delete(subscriptions);
  await db.delete(balancesSnapshots);
  await db.delete(pnlRollups);
  await db.delete(auditLog);

  await db
    .update(engineState)
    .set({
      paused: true,
      mode: "read_only",
      cancelAllOnKill: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(engineState.id, 1));

  await audit("global_reset", {});
}
