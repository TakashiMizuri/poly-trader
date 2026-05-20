import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getStoredToken } from "./client";

export const LIVE_CHANNELS = [
  "status",
  "engine",
  "balance",
  "subscriptions",
  "equity",
  "events",
  "intents",
  "executions",
] as const;

export type LiveChannel = (typeof LIVE_CHANNELS)[number];

type LiveContextValue = {
  connected: boolean;
  subscribe: (channels: LiveChannel[], onRefresh: () => void) => () => void;
};

const LiveContext = createContext<LiveContextValue | null>(null);

function parseSseBlock(block: string): { event: string; data: string } {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trimStart();
  }
  return { event, data };
}

async function consumeLiveStream(
  signal: AbortSignal,
  onEvent: (event: string, data: string) => void
): Promise<void> {
  const token = getStoredToken();
  const res = await fetch("/api/live/stream", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Live stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const block of chunks) {
      const trimmed = block.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      const { event, data } = parseSseBlock(trimmed);
      onEvent(event, data);
    }
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const subsRef = useRef(
    new Map<string, { channels: Set<LiveChannel>; onRefresh: () => void }>()
  );
  const nextId = useRef(0);

  const notify = useCallback((channels: LiveChannel[]) => {
    const channelSet = new Set(channels);
    for (const sub of subsRef.current.values()) {
      if ([...sub.channels].some((ch) => channelSet.has(ch))) {
        sub.onRefresh();
      }
    }
  }, []);

  const subscribe = useCallback((channels: LiveChannel[], onRefresh: () => void) => {
    const id = String(++nextId.current);
    subsRef.current.set(id, { channels: new Set(channels), onRefresh });
    return () => {
      subsRef.current.delete(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryMs = 1500;

    const connect = async () => {
      while (!cancelled) {
        const ac = new AbortController();
        try {
          await consumeLiveStream(ac.signal, (event, data) => {
            if (event === "connected") {
              setConnected(true);
              retryMs = 1500;
              return;
            }
            if (event !== "refresh" || !data) return;
            try {
              const payload = JSON.parse(data) as { channels?: LiveChannel[] };
              if (payload.channels?.length) notify(payload.channels);
            } catch {
              /* ignore malformed */
            }
          });
        } catch {
          if (!cancelled) setConnected(false);
        } finally {
          ac.abort();
        }

        if (cancelled) break;
        setConnected(false);
        await new Promise((r) => setTimeout(r, retryMs));
        retryMs = Math.min(retryMs * 1.5, 15_000);
      }
    };

    void connect();
    return () => {
      cancelled = true;
      setConnected(false);
    };
  }, [notify]);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveContext() {
  return useContext(LiveContext);
}

export function useLiveSubscription(channels: LiveChannel[], onRefresh: () => void) {
  const live = useLiveContext();
  const channelsKey = channels.join(",");

  useEffect(() => {
    if (!live) return;
    return live.subscribe(channels, onRefresh);
  }, [live, channelsKey, onRefresh]);
}

export function useLiveConnected(): boolean {
  return useLiveContext()?.connected ?? false;
}
