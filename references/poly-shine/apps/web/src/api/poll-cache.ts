const PREFIX = "poly-shine-poll:";

export function readPollCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writePollCache<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearAllPollCaches(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
