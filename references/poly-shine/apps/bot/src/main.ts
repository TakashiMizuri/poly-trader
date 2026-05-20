import fs from "node:fs";
import path from "node:path";
import { Telegraf, type Context } from "telegraf";
import { count, desc, eq } from "drizzle-orm";
import {
  createDb,
  type Db,
  resolveSqliteDatabasePath,
  runMigrations,
  auditLog,
  engineState,
  subscriptions,
  leaderEvents,
  mirrorIntents,
  executions,
} from "@poly-shine/db";
import { createSubscriptionSchema, parseTelegramAdminChatIds } from "@poly-shine/shared";
import { fetchCollateralBalance, getTradingClient } from "./clob.js";

const sqlitePath = resolveSqliteDatabasePath(import.meta.url);
fs.mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
runMigrations(sqlitePath);
const db: Db = createDb(sqlitePath);

function adminIds(): number[] {
  return parseTelegramAdminChatIds().map((s) => Number(s)).filter((n) => Number.isFinite(n));
}

async function audit(action: string, detail: Record<string, unknown>) {
  await db.insert(auditLog).values({ action, detail });
}

function authMiddleware() {
  return async (ctx: Context, next: () => Promise<void>) => {
    const allowed = adminIds();
    const uid = ctx.from?.id;
    if (!allowed.length) {
      await ctx.reply("Server misconfigured: set TELEGRAM_ADMIN_CHAT_IDS to your numeric Telegram user ID(s).");
      return;
    }
    if (!uid || !allowed.includes(uid)) {
      await ctx.reply("Unauthorized.");
      return;
    }
    await next();
  };
}

async function resolveSubscriptionId(arg: string): Promise<string | null> {
  const trimmed = arg.trim();
  const a = trimmed.toLowerCase();
  if (a.startsWith("0x") && a.length === 42) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.address, a)).limit(1);
    return row?.id ?? null;
  }
  const [byId] = await db.select().from(subscriptions).where(eq(subscriptions.id, trimmed)).limit(1);
  return byId?.id ?? null;
}

const helpText = `Commands:
/help — this message
/status — engine + counters
/engine — engine details
/mode <read_only|shadow|live>
/pause /resume
/cancelall <on|off> — cancel open orders when pausing
/subs — subscriptions
/addsub <0x…> fixed <usd>
/addsub <0x…> pctbal <0..1>
/addsub <0x…> pctlead <percent>
/togglesub <subscription_id>
/delsub <subscription_id>
/events [n] — recent leader events (default 8)
/intents [n] — recent mirror intents
/execs [n] — recent executions
/balance — follower USDC (CLOB)`;

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN required");
    process.exit(1);
  }
  const bot = new Telegraf(token);
  bot.use(authMiddleware());

  bot.start(async (ctx) => {
    await ctx.reply(`poly-shine operator bot.\n\n${helpText}`);
  });
  bot.help(async (ctx) => {
    await ctx.reply(helpText);
  });

  bot.command("status", async (ctx) => {
    const eng = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);
    const [sc] = await db.select({ n: count() }).from(subscriptions);
    const [ec] = await db.select({ n: count() }).from(leaderEvents);
    const [ic] = await db.select({ n: count() }).from(mirrorIntents);
    const [pc] = await db.select({ n: count() }).from(mirrorIntents).where(eq(mirrorIntents.status, "posted"));
    const e = eng[0];
    await ctx.reply(
      [
        `Engine: mode=${e?.mode} paused=${e?.paused} cancelAllOnKill=${e?.cancelAllOnKill}`,
        `Subscriptions: ${sc?.n ?? 0}`,
        `Leader events: ${ec?.n ?? 0} | Mirrors: ${ic?.n ?? 0} (posted ${pc?.n ?? 0})`,
        `DB: ${sqlitePath}`,
      ].join("\n")
    );
  });

  bot.command("engine", async (ctx) => {
    const [e] = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);
    await ctx.reply(JSON.stringify(e, null, 2));
  });

  bot.command("mode", async (ctx) => {
    const arg = ctx.message.text.split(/\s+/).slice(1).join(" ").trim().toLowerCase();
    if (!["read_only", "shadow", "live"].includes(arg)) {
      await ctx.reply("Usage: /mode read_only|shadow|live");
      return;
    }
    await db
      .update(engineState)
      .set({ mode: arg, updatedAt: new Date().toISOString() })
      .where(eq(engineState.id, 1));
    await audit("engine_mode", { mode: arg });
    await ctx.reply(`Mode set to ${arg}`);
  });

  bot.command("pause", async (ctx) => {
    await db
      .update(engineState)
      .set({ paused: true, updatedAt: new Date().toISOString() })
      .where(eq(engineState.id, 1));
    await audit("engine_pause", {});
    await ctx.reply("Paused.");
  });

  bot.command("resume", async (ctx) => {
    await db
      .update(engineState)
      .set({ paused: false, updatedAt: new Date().toISOString() })
      .where(eq(engineState.id, 1));
    await audit("engine_resume", {});
    await ctx.reply("Resumed.");
  });

  bot.command("cancelall", async (ctx) => {
    const arg = ctx.message.text.split(/\s+/).slice(1).join(" ").trim().toLowerCase();
    if (!["on", "off"].includes(arg)) {
      await ctx.reply("Usage: /cancelall on|off");
      return;
    }
    const v = arg === "on";
    await db
      .update(engineState)
      .set({ cancelAllOnKill: v, updatedAt: new Date().toISOString() })
      .where(eq(engineState.id, 1));
    await audit("engine_cancelall_on_kill", { value: v });
    await ctx.reply(`cancelAllOnKill = ${v}`);
  });

  bot.command("subs", async (ctx) => {
    const rows = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).limit(30);
    if (!rows.length) {
      await ctx.reply("No subscriptions.");
      return;
    }
    const lines = rows.map(
      (s) =>
        `${s.active ? "✓" : "✗"} id=${s.id} ${s.address}${s.label ? ` (${s.label})` : ""} mode=${s.sizingMode} fixed=${s.fixedUsd ?? "-"} pctBal=${s.pctBalance ?? "-"} pctLead=${s.pctLeaderNotional ?? "-"}`
    );
    await ctx.reply(lines.join("\n"));
  });

  bot.command("addsub", async (ctx) => {
    const parts = ctx.message.text.replace(/^\/addsub\s*/i, "").trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply("Usage: /addsub <0x…> fixed <usd> | pctbal <0-1> | pctlead <pct> | prop [scale]");
      return;
    }
    const addressArg = parts[0];
    const mode = parts[1].toLowerCase();
    if (mode !== "prop" && mode !== "proportional" && parts.length < 3) {
      await ctx.reply("Usage: /addsub <0x…> fixed <usd> | pctbal <0-1> | pctlead <pct> | prop [scale]");
      return;
    }
    const val = Number(parts[2]);
    const base = {
      address: addressArg,
      active: true,
      maxNotionalPerTrade: 500,
      maxOrdersPerSecond: 5,
    };
    let body: Record<string, unknown>;
    if (mode === "fixed") {
      body = { ...base, sizingMode: "fixed_usd", fixedUsd: val };
    } else if (mode === "pctbal") {
      body = { ...base, sizingMode: "pct_balance", pctBalance: val };
    } else if (mode === "pctlead") {
      body = { ...base, sizingMode: "pct_leader_notional", pctLeaderNotional: val };
    } else if (mode === "prop" || mode === "proportional") {
      const scale = parts[2] != null ? Number(parts[2]) : 1;
      body = { ...base, sizingMode: "proportional_equity", proportionalScale: scale };
    } else {
      await ctx.reply("Second arg must be fixed|pctbal|pctlead|prop");
      return;
    }
    const parsed = createSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      await ctx.reply(parsed.error.message);
      return;
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
      await ctx.reply(`Subscription created id=${row.id}`);
    } catch {
      await ctx.reply("Subscription for this address already exists or DB error.");
    }
  });

  bot.command("togglesub", async (ctx) => {
    const id = ctx.message.text.replace(/^\/togglesub\s*/i, "").trim();
    if (!id) {
      await ctx.reply("Usage: /togglesub <subscription_id>");
      return;
    }
    const resolved = await resolveSubscriptionId(id);
    const subId = resolved ?? id;
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.id, subId)).limit(1);
    if (!s) {
      await ctx.reply("Not found (use full id from /subs).");
      return;
    }
    const nextActive = !s.active;
    await db
      .update(subscriptions)
      .set({
        active: nextActive,
        baselineAt: nextActive ? null : s.baselineAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(subscriptions.id, subId));
    await ctx.reply(`active=${!s.active}`);
  });

  bot.command("delsub", async (ctx) => {
    const arg = ctx.message.text.replace(/^\/delsub\s*/i, "").trim();
    if (!arg) {
      await ctx.reply("Usage: /delsub <subscription_id|0x…>");
      return;
    }
    const subId = (await resolveSubscriptionId(arg)) ?? arg;
    const res = await db.delete(subscriptions).where(eq(subscriptions.id, subId)).returning({ id: subscriptions.id });
    if (!res.length) await ctx.reply("Not found.");
    else {
      await audit("subscription_delete", { id: subId });
      await ctx.reply("Deleted.");
    }
  });

  bot.command("events", async (ctx) => {
    const n = Number(ctx.message.text.split(/\s+/)[1]) || 8;
    const rows = await db.select().from(leaderEvents).orderBy(desc(leaderEvents.tradeTimestamp)).limit(Math.min(25, n));
    const lines = rows.map((e) => `${e.tradeTimestamp} ${e.side} sz=${e.size} px=${e.price} ${String(e.asset).slice(0, 12)}…`);
    await ctx.reply(lines.join("\n") || "none");
  });

  bot.command("intents", async (ctx) => {
    const n = Number(ctx.message.text.split(/\s+/)[1]) || 8;
    const rows = await db.select().from(mirrorIntents).orderBy(desc(mirrorIntents.createdAt)).limit(Math.min(25, n));
    const lines = rows.map((m) => `${m.status} ${m.skipReason ?? ""} id=${m.id}`);
    await ctx.reply(lines.join("\n") || "none");
  });

  bot.command("execs", async (ctx) => {
    const n = Number(ctx.message.text.split(/\s+/)[1]) || 8;
    const rows = await db.select().from(executions).orderBy(desc(executions.createdAt)).limit(Math.min(25, n));
    const lines = rows.map((x) => `${x.success} ${x.createdAt}`);
    await ctx.reply(lines.join("\n") || "none");
  });

  bot.command("balance", async (ctx) => {
    const client = await getTradingClient();
    if (!client) {
      await ctx.reply("POLYMARKET_PRIVATE_KEY not set or invalid.");
      return;
    }
    const usd = await fetchCollateralBalance(client);
    await ctx.reply(usd != null ? `Collateral (USDC est.): ${usd.toFixed(4)}` : "Could not read balance.");
  });

  await bot.launch();
  console.log("Telegram bot running");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
