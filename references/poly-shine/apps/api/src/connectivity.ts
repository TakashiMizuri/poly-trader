import path from "node:path";
import { count, eq, max } from "drizzle-orm";
import { engineState, leaderEvents, subscriptions } from "@poly-shine/db";
import { CLOB_HOST, DATA_API_BASE } from "@poly-shine/shared";
import { fetchCollateralBalance, getTradingClient } from "./clob.js";
import { db, sqlitePath } from "./db.js";

export type CheckStatus = "ok" | "warn" | "error" | "idle";

export type ConnectivityCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
};

export type ConnectivityResponse = {
  checks: ConnectivityCheck[];
  checkedAt: string;
};

const WORKER_STALE_MS = 90_000;

async function checkDatabase(): Promise<ConnectivityCheck> {
  try {
    await db.select({ id: engineState.id }).from(engineState).limit(1);
    const resolved = path.resolve(sqlitePath);
    return {
      id: "database",
      label: "Database",
      status: "ok",
      detail: `${path.basename(resolved)} — ${resolved}`,
    };
  } catch (e) {
    return {
      id: "database",
      label: "Database",
      status: "error",
      detail: e instanceof Error ? e.message : "Query failed",
    };
  }
}

async function checkClob(): Promise<ConnectivityCheck> {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk?.startsWith("0x")) {
    return {
      id: "clob",
      label: "Polymarket CLOB",
      status: "warn",
      detail: "POLYMARKET_PRIVATE_KEY not configured",
    };
  }
  try {
    const client = await getTradingClient();
    if (!client) {
      return {
        id: "clob",
        label: "Polymarket CLOB",
        status: "error",
        detail: "Trading client failed to initialize",
      };
    }
    const usd = await fetchCollateralBalance(client);
    if (usd == null) {
      return {
        id: "clob",
        label: "Polymarket CLOB",
        status: "warn",
        detail: `${CLOB_HOST} — reachable, balance unavailable`,
      };
    }
    return {
      id: "clob",
      label: "Polymarket CLOB",
      status: "ok",
      detail: `${CLOB_HOST} — USDC ${usd.toFixed(2)}`,
    };
  } catch (e) {
    return {
      id: "clob",
      label: "Polymarket CLOB",
      status: "error",
      detail: e instanceof Error ? e.message : "Connection failed",
    };
  }
}

async function checkDataApi(): Promise<ConnectivityCheck> {
  try {
    const url = new URL(`${DATA_API_BASE}/trades`);
    url.searchParams.set("user", "0x0000000000000000000000000000000000000001");
    url.searchParams.set("limit", "1");
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      return {
        id: "data_api",
        label: "Polymarket Data API",
        status: "error",
        detail: `HTTP ${res.status}`,
      };
    }
    return {
      id: "data_api",
      label: "Polymarket Data API",
      status: "ok",
      detail: DATA_API_BASE,
    };
  } catch (e) {
    return {
      id: "data_api",
      label: "Polymarket Data API",
      status: "error",
      detail: e instanceof Error ? e.message : "Unreachable",
    };
  }
}

async function checkWorker(): Promise<ConnectivityCheck> {
  try {
    const [activeRow] = await db
      .select({ n: count() })
      .from(subscriptions)
      .where(eq(subscriptions.active, true));
    const active = activeRow?.n ?? 0;
    if (active === 0) {
      return {
        id: "worker",
        label: "Worker / ingestion",
        status: "idle",
        detail: "No active subscriptions",
      };
    }

    const [ev] = await db.select({ maxCreated: max(leaderEvents.createdAt) }).from(leaderEvents);
    const [sub] = await db
      .select({ maxUpdated: max(subscriptions.updatedAt) })
      .from(subscriptions)
      .where(eq(subscriptions.active, true));

    const latestIso = [ev?.maxCreated, sub?.maxUpdated]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort()
      .pop();

    if (!latestIso) {
      return {
        id: "worker",
        label: "Worker / ingestion",
        status: "warn",
        detail: `${active} active sub(s) — no DB activity yet`,
      };
    }

    const ageMs = Date.now() - new Date(latestIso).getTime();
    if (ageMs > WORKER_STALE_MS) {
      return {
        id: "worker",
        label: "Worker / ingestion",
        status: "warn",
        detail: `No recent activity (${Math.round(ageMs / 1000)}s ago, ${active} active subs)`,
      };
    }

    return {
      id: "worker",
      label: "Worker / ingestion",
      status: "ok",
      detail: `${active} active sub(s) — last activity ${Math.round(ageMs / 1000)}s ago`,
    };
  } catch (e) {
    return {
      id: "worker",
      label: "Worker / ingestion",
      status: "error",
      detail: e instanceof Error ? e.message : "Check failed",
    };
  }
}

function checkTelegram(): ConnectivityCheck {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admins = process.env.TELEGRAM_ADMIN_CHAT_IDS?.trim();
  if (!token) {
    return {
      id: "telegram",
      label: "Telegram alerts",
      status: "idle",
      detail: "TELEGRAM_BOT_TOKEN not configured",
    };
  }
  if (!admins) {
    return {
      id: "telegram",
      label: "Telegram alerts",
      status: "warn",
      detail: "Bot token set — TELEGRAM_ADMIN_CHAT_IDS missing",
    };
  }
  return {
    id: "telegram",
    label: "Telegram alerts",
    status: "ok",
    detail: "Bot configured",
  };
}

export async function runConnectivityChecks(): Promise<ConnectivityResponse> {
  const checks = await Promise.all([
    checkDatabase(),
    checkClob(),
    checkDataApi(),
    checkWorker(),
    Promise.resolve(checkTelegram()),
  ]);
  return { checks, checkedAt: new Date().toISOString() };
}
