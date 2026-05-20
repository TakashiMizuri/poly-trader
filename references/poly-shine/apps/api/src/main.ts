import { serve } from "@hono/node-server";

import { Hono } from "hono";

import { cors } from "hono/cors";

import { and, count, desc, eq } from "drizzle-orm";

import {

  auditLog,

  engineState,

  subscriptions,

  leaderEvents,

  mirrorIntents,

  executions,

  positionFollowState,

} from "@poly-shine/db";

import {
  createSubscriptionSchema,
  engineStateUpdateSchema,
  updateSubscriptionSchema,
} from "@poly-shine/shared";

import { db, sqlitePath } from "./db.js";

import { audit } from "./audit.js";
import { enrichMarketsForAssets, marketFields } from "./marketMeta.js";

import {
  fetchCollateralBalance,
  getFollowerWalletAddress,
  getTradingClient,
} from "./clob.js";
import {
  fetchPolymarketEquity,
  fetchPolymarketEquityBatch,
  fetchPolymarketPortfolio,
  fetchPolymarketPortfolioBatch,
  fetchPolymarketPublicProfile,
  resolvePolymarketDisplayName,
  resolvePolymarketMarketsFromInput,
  refreshPolymarketMarketList,
} from "@poly-shine/shared";
import { registerLiveRoutes } from "./live.js";
import { runConnectivityChecks } from "./connectivity.js";
import { runGlobalReset } from "./reset.js";
import { runWorkshopScreenerTick, runWorkshopScreenerTickBatch } from "./workshop-screener.js";

const app = new Hono();



const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

app.use(

  "*",

  cors({

    origin: webOrigin.split(",").map((s) => s.trim()),

    allowHeaders: ["Authorization", "Content-Type"],

    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],

  })

);



function apiToken(): string | undefined {

  return process.env.WEB_API_TOKEN?.trim() || undefined;

}



app.use("/api/*", async (c, next) => {

  const token = apiToken();

  if (!token) {

    return c.json({ error: "Server misconfigured: set WEB_API_TOKEN in .env" }, 503);

  }

  const auth = c.req.header("Authorization");

  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (bearer !== token) {

    return c.json({ error: "Unauthorized" }, 401);

  }

  await next();

});



app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/connectivity", async (c) => {
  const result = await runConnectivityChecks();
  return c.json(result);
});

app.get("/api/status", async (c) => {

  const eng = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);

  const [sc] = await db.select({ n: count() }).from(subscriptions);

  const [ec] = await db.select({ n: count() }).from(leaderEvents);

  const [ic] = await db.select({ n: count() }).from(mirrorIntents);

  const [pc] = await db.select({ n: count() }).from(mirrorIntents).where(eq(mirrorIntents.status, "posted"));

  const e = eng[0];

  return c.json({

    engine: e ?? null,

    counts: {

      subscriptions: sc?.n ?? 0,

      leaderEvents: ec?.n ?? 0,

      mirrorIntents: ic?.n ?? 0,

      mirrorPosted: pc?.n ?? 0,

    },

    sqlitePath,

  });

});



app.get("/api/engine", async (c) => {

  const [e] = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);

  return c.json(e ?? null);

});



app.patch("/api/engine", async (c) => {

  const body = await c.req.json().catch(() => ({}));

  const parsed = engineStateUpdateSchema.safeParse(body);

  if (!parsed.success) {

    return c.json({ error: parsed.error.flatten() }, 400);

  }

  const patch = { ...parsed.data, updatedAt: new Date().toISOString() };

  if (Object.keys(parsed.data).length === 0) {

    return c.json({ error: "No fields to update" }, 400);

  }

  await db.update(engineState).set(patch).where(eq(engineState.id, 1));

  if (parsed.data.mode != null) await audit("engine_mode", { mode: parsed.data.mode });

  if (parsed.data.paused === true) await audit("engine_pause", {});

  if (parsed.data.paused === false) await audit("engine_resume", {});

  if (parsed.data.cancelAllOnKill != null) {

    await audit("engine_cancelall_on_kill", { value: parsed.data.cancelAllOnKill });

  }

  const [e] = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);

  return c.json(e ?? null);

});



app.post("/api/engine/pause", async (c) => {

  await db

    .update(engineState)

    .set({ paused: true, updatedAt: new Date().toISOString() })

    .where(eq(engineState.id, 1));

  await audit("engine_pause", {});

  const [e] = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);

  return c.json(e ?? null);

});



app.post("/api/engine/resume", async (c) => {

  await db

    .update(engineState)

    .set({ paused: false, updatedAt: new Date().toISOString() })

    .where(eq(engineState.id, 1));

  await audit("engine_resume", {});

  const [e] = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);

  return c.json(e ?? null);

});



app.get("/api/subscriptions", async (c) => {

  const limit = Math.min(50, Number(c.req.query("limit")) || 30);

  const rows = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).limit(limit);

  return c.json(rows);

});



app.post("/api/subscriptions", async (c) => {

  const body = await c.req.json();

  const parsed = createSubscriptionSchema.safeParse(body);

  if (!parsed.success) {

    return c.json({ error: parsed.error.flatten() }, 400);

  }

  const d = parsed.data;

  const address = d.address.toLowerCase();

  try {

    const [row] = await db

      .insert(subscriptions)

      .values({

        address,

        label: d.label ?? null,

        active: d.active ?? true,

        sizingMode: d.sizingMode,

        fixedUsd: d.sizingMode === "fixed_usd" ? String(d.fixedUsd) : null,

        pctBalance:
          d.sizingMode === "pct_balance"
            ? String(d.pctBalance)
            : d.sizingMode === "proportional_equity"
              ? String(d.proportionalScale ?? 1)
              : null,

        pctLeaderNotional: d.sizingMode === "pct_leader_notional" ? String(d.pctLeaderNotional) : null,

        maxNotionalPerTrade: d.maxNotionalPerTrade != null ? String(d.maxNotionalPerTrade) : null,

        maxOpenExposureUsd: d.maxOpenExposureUsd != null ? String(d.maxOpenExposureUsd) : null,

        maxDailyLossUsd: d.maxDailyLossUsd != null ? String(d.maxDailyLossUsd) : null,

        maxOrdersPerSecond: d.maxOrdersPerSecond ?? 5,

        maxSlippageBps: d.maxSlippageBps ?? 150,

        followFromTimestamp: Date.now(),

      })

      .returning();

    await audit("subscription_create", { id: row.id, address });

    return c.json(row, 201);

  } catch {

    return c.json({ error: "Subscription for this address already exists or DB error" }, 409);

  }

});



app.patch("/api/subscriptions/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const d = parsed.data;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (d.label !== undefined) patch.label = d.label;
  if (d.active !== undefined) {
    patch.active = d.active;
    if (d.active && !existing.active) patch.baselineAt = null;
  }
  if (d.maxNotionalPerTrade !== undefined) {
    patch.maxNotionalPerTrade = d.maxNotionalPerTrade != null ? String(d.maxNotionalPerTrade) : null;
  }
  if (d.maxOpenExposureUsd !== undefined) {
    patch.maxOpenExposureUsd = d.maxOpenExposureUsd != null ? String(d.maxOpenExposureUsd) : null;
  }
  if (d.maxDailyLossUsd !== undefined) {
    patch.maxDailyLossUsd = d.maxDailyLossUsd != null ? String(d.maxDailyLossUsd) : null;
  }
  if (d.maxOrdersPerSecond !== undefined) patch.maxOrdersPerSecond = d.maxOrdersPerSecond;
  if (d.maxSlippageBps !== undefined) patch.maxSlippageBps = d.maxSlippageBps;

  if (d.sizingMode !== undefined) {
    patch.sizingMode = d.sizingMode;
    patch.fixedUsd = d.sizingMode === "fixed_usd" ? String(d.fixedUsd) : null;
    patch.pctBalance =
      d.sizingMode === "pct_balance"
        ? String(d.pctBalance)
        : d.sizingMode === "proportional_equity"
          ? String(d.proportionalScale ?? 1)
          : null;
    patch.pctLeaderNotional =
      d.sizingMode === "pct_leader_notional" ? String(d.pctLeaderNotional) : null;
  } else if (d.proportionalScale !== undefined && existing.sizingMode === "proportional_equity") {
    patch.pctBalance = String(d.proportionalScale);
  }

  const [row] = await db
    .update(subscriptions)
    .set(patch)
    .where(eq(subscriptions.id, id))
    .returning();

  await audit("subscription_update", { id, fields: Object.keys(patch) });
  return c.json(row);
});

app.post("/api/subscriptions/:id/toggle", async (c) => {

  const id = c.req.param("id");

  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);

  if (!s) return c.json({ error: "Not found" }, 404);

  const nextActive = !s.active;
  const [row] = await db

    .update(subscriptions)

    .set({
      active: nextActive,
      baselineAt: nextActive ? null : s.baselineAt,
      updatedAt: new Date().toISOString(),
    })

    .where(eq(subscriptions.id, id))

    .returning();

  return c.json(row);

});



app.delete("/api/subscriptions/:id", async (c) => {

  const id = c.req.param("id");

  const res = await db.delete(subscriptions).where(eq(subscriptions.id, id)).returning({ id: subscriptions.id });

  if (!res.length) return c.json({ error: "Not found" }, 404);

  await audit("subscription_delete", { id });

  return c.json({ ok: true });

});



function parseLimit(q: string | undefined, fallback = 8): number {

  return Math.min(100, Math.max(1, Number(q) || fallback));

}



app.get("/api/events", async (c) => {

  const limit = parseLimit(c.req.query("limit"));

  const rows = await db.select().from(leaderEvents).orderBy(desc(leaderEvents.tradeTimestamp)).limit(limit);

  return c.json(rows);

});



app.get("/api/intents", async (c) => {

  const limit = parseLimit(c.req.query("limit"));

  const rows = await db
    .select({
      id: mirrorIntents.id,
      subscriptionId: mirrorIntents.subscriptionId,
      leaderEventId: mirrorIntents.leaderEventId,
      status: mirrorIntents.status,
      skipReason: mirrorIntents.skipReason,
      planned: mirrorIntents.planned,
      createdAt: mirrorIntents.createdAt,
      asset: leaderEvents.asset,
      eventRaw: leaderEvents.raw,
    })
    .from(mirrorIntents)
    .innerJoin(leaderEvents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .orderBy(desc(mirrorIntents.createdAt))
    .limit(limit);

  const marketCache = await enrichMarketsForAssets(
    rows.map((r) => ({ asset: r.asset, raw: r.eventRaw }))
  );

  return c.json(
    rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscriptionId,
      leaderEventId: r.leaderEventId,
      status: r.status,
      skipReason: r.skipReason,
      planned: r.planned,
      createdAt: r.createdAt,
      ...marketFields(r.asset, r.eventRaw, marketCache),
    }))
  );

});



app.get("/api/executions", async (c) => {

  const limit = parseLimit(c.req.query("limit"));

  const rows = await db.select().from(executions).orderBy(desc(executions.createdAt)).limit(limit);

  return c.json(rows);

});



app.get("/api/feed", async (c) => {

  const limit = parseLimit(c.req.query("limit"), 20);

  const rows = await db

    .select({

      eventId: leaderEvents.id,

      tradeTimestamp: leaderEvents.tradeTimestamp,

      eventCreatedAt: leaderEvents.createdAt,

      side: leaderEvents.side,

      leaderSize: leaderEvents.size,

      leaderPrice: leaderEvents.price,

      asset: leaderEvents.asset,

      eventRaw: leaderEvents.raw,

      subscriptionId: subscriptions.id,

      subscriptionLabel: subscriptions.label,

      subscriptionAddress: subscriptions.address,

      subscriptionActive: subscriptions.active,

      intentId: mirrorIntents.id,

      intentStatus: mirrorIntents.status,

      skipReason: mirrorIntents.skipReason,

      planned: mirrorIntents.planned,

      executionSuccess: executions.success,

      followLineState: positionFollowState.state,

      followLineAbandonedReason: positionFollowState.abandonedReason,

    })

    .from(leaderEvents)

    .innerJoin(subscriptions, eq(leaderEvents.subscriptionId, subscriptions.id))

    .leftJoin(mirrorIntents, eq(mirrorIntents.leaderEventId, leaderEvents.id))

    .leftJoin(executions, eq(executions.mirrorIntentId, mirrorIntents.id))

    .leftJoin(
      positionFollowState,
      and(
        eq(positionFollowState.subscriptionId, subscriptions.id),
        eq(positionFollowState.asset, leaderEvents.asset)
      )
    )

    .orderBy(desc(leaderEvents.tradeTimestamp))

    .limit(limit * 3);

  const seen = new Set<string>();
  const unique = [];
  for (const r of rows) {
    if (seen.has(r.eventId)) continue;
    seen.add(r.eventId);
    unique.push(r);
    if (unique.length >= limit) break;
  }

  const marketCache = await enrichMarketsForAssets(
    unique.map((r) => ({ asset: r.asset, raw: r.eventRaw }))
  );

  return c.json(

    unique.map((r) => ({

      eventId: r.eventId,

      tradeTimestamp: r.tradeTimestamp,

      eventCreatedAt: r.eventCreatedAt,

      side: r.side,

      leaderSize: r.leaderSize,

      leaderPrice: r.leaderPrice,

      asset: r.asset,

      subscriptionId: r.subscriptionId,

      subscriptionLabel: r.subscriptionLabel,

      subscriptionAddress: r.subscriptionAddress,

      subscriptionActive: r.subscriptionActive,

      intentId: r.intentId,

      intentStatus: r.intentStatus,

      skipReason: r.skipReason,

      planned: r.planned,

      executed: r.executionSuccess ?? null,

      followLineState: r.followLineState ?? null,

      followLineAbandonedReason: r.followLineAbandonedReason ?? null,

      ...marketFields(r.asset, r.eventRaw, marketCache),

    }))

  );

});



app.get("/api/me", async (c) => {
  const address = getFollowerWalletAddress();
  if (!address) {
    return c.json({ error: "POLYMARKET_PRIVATE_KEY not set or invalid", address: null, displayName: null }, 503);
  }

  try {
    const profile = await fetchPolymarketPublicProfile(address);
    const displayName = profile ? resolvePolymarketDisplayName(profile) : null;
    return c.json({
      address,
      displayName,
      profileImage: profile?.profileImage ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch profile";
    return c.json({ error: message, address, displayName: null, profileImage: null }, 502);
  }
});



app.get("/api/balance", async (c) => {

  const client = await getTradingClient();

  if (!client) {

    return c.json({ error: "POLYMARKET_PRIVATE_KEY not set or invalid", usd: null }, 503);

  }

  const usd = await fetchCollateralBalance(client);

  return c.json({ usd });

});



app.get("/api/follower/equity", async (c) => {
  const address = getFollowerWalletAddress();
  if (!address) {
    return c.json({ error: "POLYMARKET_PRIVATE_KEY not set or invalid" }, 503);
  }

  try {
    const equity = await fetchPolymarketEquity(address);
    return c.json(equity);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch equity";
    return c.json({ error: message }, 502);
  }
});



app.get("/api/equity", async (c) => {

  const user = c.req.query("user");

  if (!user?.trim()) return c.json({ error: "Missing user query parameter" }, 400);

  try {

    const equity = await fetchPolymarketEquity(user);

    return c.json(equity);

  } catch (e) {

    const message = e instanceof Error ? e.message : "Failed to fetch equity";

    return c.json({ error: message }, 502);

  }

});



app.post("/api/equity/batch", async (c) => {

  const body = await c.req.json().catch(() => null);

  const addresses = Array.isArray(body?.addresses) ? (body.addresses as unknown[]) : null;

  if (!addresses?.length) return c.json({ error: "addresses array required" }, 400);

  if (addresses.length > 30) return c.json({ error: "At most 30 addresses per request" }, 400);

  const strings = addresses.filter((a): a is string => typeof a === "string");

  const balances = await fetchPolymarketEquityBatch(strings);

  return c.json({ balances });

});



app.get("/api/workshop/portfolio", async (c) => {

  const user = c.req.query("user");

  if (!user?.trim()) return c.json({ error: "Missing user query parameter" }, 400);

  try {

    const portfolio = await fetchPolymarketPortfolio(user);

    return c.json(portfolio);

  } catch (e) {

    const message = e instanceof Error ? e.message : "Failed to fetch portfolio";

    return c.json({ error: message }, 502);

  }

});



app.post("/api/workshop/portfolio/batch", async (c) => {

  const body = await c.req.json().catch(() => null);

  const addresses = Array.isArray(body?.addresses) ? (body.addresses as unknown[]) : null;

  if (!addresses?.length) return c.json({ error: "addresses array required" }, 400);

  if (addresses.length > 15) return c.json({ error: "At most 15 addresses per request" }, 400);

  const strings = addresses.filter((a): a is string => typeof a === "string");

  const portfolios = await fetchPolymarketPortfolioBatch(strings);

  return c.json({ portfolios });

});



app.post("/api/workshop/screener/resolve", async (c) => {

  const body = await c.req.json().catch(() => null);

  const input = typeof body?.input === "string" ? body.input : null;

  if (!input?.trim()) return c.json({ error: "input string required" }, 400);

  try {

    const markets = await resolvePolymarketMarketsFromInput(input);

    return c.json({ markets });

  } catch (e) {

    const message = e instanceof Error ? e.message : "Failed to resolve market";

    return c.json({ error: message }, 400);

  }

});



app.post("/api/workshop/screener/markets/refresh", async (c) => {

  const body = await c.req.json().catch(() => null);

  const raw = body?.markets;

  if (!Array.isArray(raw)) return c.json({ error: "markets array required" }, 400);

  const markets = raw.filter(

    (m): m is { conditionId: string; title: string; slug: string | null; closed: boolean | null } =>

      m != null &&

      typeof m === "object" &&

      typeof m.conditionId === "string" &&

      typeof m.title === "string"

  );

  try {

    const result = await refreshPolymarketMarketList(markets);

    return c.json(result);

  } catch (e) {

    const message = e instanceof Error ? e.message : "Failed to refresh markets";

    return c.json({ error: message }, 502);

  }

});



app.post("/api/workshop/screener/tick", async (c) => {

  const body = await c.req.json().catch(() => null);

  const conditionId = typeof body?.conditionId === "string" ? body.conditionId.trim() : null;

  if (!conditionId) return c.json({ error: "conditionId required" }, 400);

  try {

    const result = await runWorkshopScreenerTick(conditionId, body?.cacheTimes);

    return c.json(result);

  } catch (e) {

    const message = e instanceof Error ? e.message : "Screener tick failed";

    return c.json({ error: message }, 502);

  }

});



app.post("/api/workshop/screener/tick-batch", async (c) => {

  const body = await c.req.json().catch(() => null);

  const raw = body?.conditionIds;

  if (!Array.isArray(raw) || raw.length === 0) {
    return c.json({ error: "conditionIds array required" }, 400);
  }

  const conditionIds = raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  if (conditionIds.length === 0) return c.json({ error: "conditionIds array required" }, 400);

  try {

    const result = await runWorkshopScreenerTickBatch(conditionIds, body?.cacheTimes);

    return c.json(result);

  } catch (e) {

    const message = e instanceof Error ? e.message : "Screener tick batch failed";

    return c.json({ error: message }, 502);

  }

});



app.get("/api/audit", async (c) => {

  const limit = Math.min(50, Number(c.req.query("limit")) || 20);

  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);

  return c.json(rows);

});



app.post("/api/admin/reset", async (c) => {

  await runGlobalReset();

  return c.json({ ok: true });

});

registerLiveRoutes(app);

const port = Number(process.env.WEB_API_PORT ?? "3001");

console.log(`API listening on http://localhost:${port} (CORS: ${webOrigin})`);

serve({ fetch: app.fetch, port });

