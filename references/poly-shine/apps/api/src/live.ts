import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { count, desc, eq, max } from "drizzle-orm";
import {
  engineState,
  subscriptions,
  leaderEvents,
  mirrorIntents,
  executions,
} from "@poly-shine/db";
import { db } from "./db.js";

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

type Fingerprints = Record<LiveChannel, string>;

type LiveListener = (channels: LiveChannel[]) => void;

const TICK_MS = 1500;
const BALANCE_TICK_MS = 15_000;
const EQUITY_TICK_MS = 25_000;

let prev: Fingerprints | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let balanceTimer: ReturnType<typeof setInterval> | null = null;
let equityTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<LiveListener>();

async function computeFingerprints(): Promise<Fingerprints> {
  const [
    engRows,
    subAgg,
    eventAgg,
    intentAgg,
    execAgg,
    postedAgg,
    latestEvent,
    latestIntent,
    latestExec,
  ] = await Promise.all([
    db.select().from(engineState).where(eq(engineState.id, 1)).limit(1),
    db
      .select({ n: count(), maxUpdated: max(subscriptions.updatedAt) })
      .from(subscriptions),
    db.select({ n: count(), maxTs: max(leaderEvents.tradeTimestamp) }).from(leaderEvents),
    db
      .select({
        n: count(),
        maxUpdated: max(mirrorIntents.updatedAt),
        maxCreated: max(mirrorIntents.createdAt),
      })
      .from(mirrorIntents),
    db.select({ n: count(), maxCreated: max(executions.createdAt) }).from(executions),
    db
      .select({ n: count() })
      .from(mirrorIntents)
      .where(eq(mirrorIntents.status, "posted")),
    db
      .select({ id: leaderEvents.id, ts: leaderEvents.tradeTimestamp })
      .from(leaderEvents)
      .orderBy(desc(leaderEvents.tradeTimestamp))
      .limit(1),
    db
      .select({ id: mirrorIntents.id, updatedAt: mirrorIntents.updatedAt })
      .from(mirrorIntents)
      .orderBy(desc(mirrorIntents.updatedAt))
      .limit(1),
    db
      .select({ id: executions.id })
      .from(executions)
      .orderBy(desc(executions.createdAt))
      .limit(1),
  ]);

  const eng = engRows[0];
  const subs = subAgg[0];
  const ev = eventAgg[0];
  const intents = intentAgg[0];
  const execs = execAgg[0];
  const posted = postedAgg[0];
  const headEvent = latestEvent[0];
  const headIntent = latestIntent[0];
  const headExec = latestExec[0];

  const engineFp = eng
    ? `${eng.updatedAt}|${eng.mode}|${eng.paused}|${eng.cancelAllOnKill}`
    : "none";

  const statusFp = `${engineFp}|${subs?.n ?? 0}|${ev?.n ?? 0}|${intents?.n ?? 0}|${posted?.n ?? 0}`;

  return {
    status: statusFp,
    engine: engineFp,
    balance: "",
    subscriptions: `${subs?.n ?? 0}|${subs?.maxUpdated ?? ""}`,
    equity: "",
    events: headEvent ? `${headEvent.id}|${headEvent.ts}|${ev?.n ?? 0}` : `0|0|${ev?.n ?? 0}`,
    intents: headIntent
      ? `${headIntent.id}|${headIntent.updatedAt}|${intents?.n ?? 0}|${intents?.maxUpdated ?? ""}|${intents?.maxCreated ?? ""}`
      : `0|0|${intents?.n ?? 0}`,
    executions: headExec
      ? `${headExec.id}|${execs?.maxCreated ?? ""}|${execs?.n ?? 0}`
      : `0|0|${execs?.n ?? 0}`,
  };
}

function diffChannels(prevFp: Fingerprints, nextFp: Fingerprints): LiveChannel[] {
  const changed: LiveChannel[] = [];
  for (const ch of LIVE_CHANNELS) {
    if (ch === "balance" || ch === "equity") continue;
    if (prevFp[ch] !== nextFp[ch]) changed.push(ch);
  }
  return changed;
}

function emit(channels: LiveChannel[]) {
  if (!channels.length) return;
  for (const listener of listeners) listener(channels);
}

function ensureWatcher() {
  if (tickTimer) return;

  void (async () => {
    prev = await computeFingerprints();
  })();

  tickTimer = setInterval(() => {
    void (async () => {
      try {
        const next = await computeFingerprints();
        if (!prev) {
          prev = next;
          return;
        }
        const changed = diffChannels(prev, next);
        prev = next;
        if (changed.length) emit(changed);
      } catch (e) {
        console.error("live watcher tick failed", e);
      }
    })();
  }, TICK_MS);

  balanceTimer = setInterval(() => emit(["balance"]), BALANCE_TICK_MS);
  equityTimer = setInterval(() => emit(["equity"]), EQUITY_TICK_MS);
}

function subscribe(listener: LiveListener): () => void {
  ensureWatcher();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      clearInterval(balanceTimer!);
      clearInterval(equityTimer!);
      tickTimer = null;
      balanceTimer = null;
      equityTimer = null;
      prev = null;
    }
  };
}

export function registerLiveRoutes(app: Hono) {
  app.get("/api/live/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const abort = c.req.raw.signal;
      let closed = false;
      const onAbort = () => {
        closed = true;
      };
      abort?.addEventListener("abort", onAbort);

      const unsub = subscribe((channels) => {
        if (closed) return;
        void stream.writeSSE({
          event: "refresh",
          data: JSON.stringify({ channels }),
        });
      });

      try {
        await stream.writeSSE({
          event: "connected",
          data: JSON.stringify({ channels: LIVE_CHANNELS }),
        });

        while (!closed) {
          await stream.writeSSE({ event: "ping", data: "" });
          await stream.sleep(20_000);
        }
      } finally {
        abort?.removeEventListener("abort", onAbort);
        unsub();
      }
    });
  });
}
