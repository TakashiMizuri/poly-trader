/** Stable leader-fill order: exchange time, ingestion time, then id tie-break. */
export type LeaderEventOrderKey = {
  tradeTimestamp: number;
  createdAt: string;
  id: string;
};

export function compareLeaderEvents(a: LeaderEventOrderKey, b: LeaderEventOrderKey): number {
  if (a.tradeTimestamp !== b.tradeTimestamp) return a.tradeTimestamp - b.tradeTimestamp;
  const byCreated = a.createdAt.localeCompare(b.createdAt);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

export function isLeaderEventBefore(event: LeaderEventOrderKey, before: LeaderEventOrderKey): boolean {
  return compareLeaderEvents(event, before) < 0;
}
