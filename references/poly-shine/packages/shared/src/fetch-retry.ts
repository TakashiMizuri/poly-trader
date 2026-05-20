function isTransientFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  if (msg.includes("fetch failed")) return true;
  const cause = e.cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return true;
    }
  }
  return false;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Retry fn on transient network errors (undici "fetch failed", resets, timeouts). */
export async function withFetchRetry<T>(
  fn: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number }
): Promise<T> {
  const attempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 400;
  let last: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i >= attempts - 1 || !isTransientFetchError(e)) throw e;
      await sleep(baseDelayMs * (i + 1));
    }
  }

  throw last;
}
