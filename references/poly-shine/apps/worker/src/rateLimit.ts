const buckets = new Map<string, number[]>();

export function allowOrder(subscriptionId: string, maxPerSecond: number): boolean {
  const now = Date.now();
  const windowMs = 1000;
  const arr = buckets.get(subscriptionId) ?? [];
  const pruned = arr.filter((t) => now - t < windowMs);
  if (pruned.length >= maxPerSecond) {
    return false;
  }
  pruned.push(now);
  buckets.set(subscriptionId, pruned);
  return true;
}
