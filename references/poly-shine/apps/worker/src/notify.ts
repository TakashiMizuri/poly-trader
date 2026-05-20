import { notifyAdmins } from "@poly-shine/shared";

const lastAlertAt = new Map<string, number>();

export const INGESTION_ALERT_COOLDOWN_MS = 10 * 60 * 1000;

export function formatWorkerError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause;
  if (cause instanceof Error && cause.message) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : cause.name;
    return `${e.message} (${code}: ${cause.message})`;
  }
  return e.message;
}

export async function notifyTelegram(opts: {
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
}): Promise<void> {
  await notifyAdmins(opts);
}

/** Sends at most one alert per `key` within `cooldownMs`. Returns whether a message was sent. */
export async function notifyTelegramThrottled(
  key: string,
  opts: {
    title: string;
    body: string;
    severity: "info" | "warning" | "critical";
  },
  cooldownMs = INGESTION_ALERT_COOLDOWN_MS
): Promise<boolean> {
  const now = Date.now();
  const last = lastAlertAt.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  lastAlertAt.set(key, now);
  await notifyAdmins(opts);
  return true;
}
