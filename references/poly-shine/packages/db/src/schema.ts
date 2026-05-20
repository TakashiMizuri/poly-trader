import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const engineState = sqliteTable("engine_state", {
  id: integer("id").primaryKey(),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  mode: text("mode", { length: 32 }).notNull().default("read_only"),
  cancelAllOnKill: integer("cancel_all_on_kill", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    address: text("address", { length: 42 }).notNull(),
    label: text("label"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastTradeTimestamp: integer("last_trade_timestamp"),
    sizingMode: text("sizing_mode", { length: 32 }).notNull(),
    fixedUsd: text("fixed_usd", { length: 64 }),
    pctBalance: text("pct_balance", { length: 64 }),
    pctLeaderNotional: text("pct_leader_notional", { length: 64 }),
    maxNotionalPerTrade: text("max_notional_per_trade", { length: 64 }),
    maxOpenExposureUsd: text("max_open_exposure_usd", { length: 64 }),
    maxDailyLossUsd: text("max_daily_loss_usd", { length: 64 }),
    maxOrdersPerSecond: integer("max_orders_per_second").default(5),
    maxSlippageBps: integer("max_slippage_bps").default(150),
    /** Unix ms: only mirror leader activity at or after this time. */
    followFromTimestamp: integer("follow_from_timestamp"),
    /** Unix ms: last snapshot of leader open positions marked pre-existing. */
    baselineAt: integer("baseline_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("subscriptions_address_unique").on(t.address), index("subscriptions_active_idx").on(t.active)]
);

export const leaderEvents = sqliteTable(
  "leader_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    txHash: text("tx_hash", { length: 80 }),
    asset: text("asset").notNull(),
    conditionId: text("condition_id", { length: 66 }),
    side: text("side", { length: 8 }).notNull(),
    size: text("size", { length: 64 }).notNull(),
    price: text("price", { length: 64 }).notNull(),
    tradeTimestamp: integer("trade_timestamp").notNull(),
    raw: text("raw", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("leader_events_dedupe_unique").on(t.dedupeKey),
    index("leader_events_sub_ts_idx").on(t.subscriptionId, t.tradeTimestamp),
  ]
);

export const positionFollowState = sqliteTable(
  "position_follow_state",
  {
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    asset: text("asset").notNull(),
    state: text("state", { length: 24 }).notNull().default("untracked"),
    abandonedReason: text("abandoned_reason"),
    entryLeaderEventId: text("entry_leader_event_id"),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("position_follow_state_sub_asset_unique").on(t.subscriptionId, t.asset),
    index("position_follow_state_sub_idx").on(t.subscriptionId),
  ]
);

export const mirrorIntents = sqliteTable(
  "mirror_intents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    leaderEventId: text("leader_event_id")
      .notNull()
      .references(() => leaderEvents.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status", { length: 24 }).notNull().default("pending"),
    skipReason: text("skip_reason"),
    planned: text("planned", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("mirror_intents_dedupe_unique").on(t.dedupeKey), index("mirror_intents_sub_idx").on(t.subscriptionId)]
);

export const executions = sqliteTable(
  "executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mirrorIntentId: text("mirror_intent_id")
      .notNull()
      .references(() => mirrorIntents.id, { onDelete: "cascade" }),
    success: integer("success", { mode: "boolean" }).notNull(),
    raw: text("raw", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("executions_intent_idx").on(t.mirrorIntentId)]
);

export const balancesSnapshots = sqliteTable("balances_snapshots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  scope: text("scope", { length: 64 }).notNull(),
  refAddress: text("ref_address", { length: 42 }),
  balanceUsd: text("balance_usd", { length: 64 }),
  raw: text("raw", { mode: "json" }).$type<Record<string, unknown> | null>(),
  snapshotAt: text("snapshot_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const pnlRollups = sqliteTable(
  "pnl_rollups",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    periodStart: text("period_start").notNull(),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    pnlUsd: text("pnl_usd", { length: 64 }).notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("pnl_rollups_period_idx").on(t.periodStart)]
);

export const auditLog = sqliteTable("audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  action: text("action", { length: 128 }).notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const subscriptionsRelations = relations(subscriptions, ({ many }) => ({
  leaderEvents: many(leaderEvents),
  mirrorIntents: many(mirrorIntents),
  positionFollowStates: many(positionFollowState),
}));

export const positionFollowStateRelations = relations(positionFollowState, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [positionFollowState.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const leaderEventsRelations = relations(leaderEvents, ({ one, many }) => ({
  subscription: one(subscriptions, {
    fields: [leaderEvents.subscriptionId],
    references: [subscriptions.id],
  }),
  mirrorIntents: many(mirrorIntents),
}));

export const mirrorIntentsRelations = relations(mirrorIntents, ({ one, many }) => ({
  subscription: one(subscriptions, {
    fields: [mirrorIntents.subscriptionId],
    references: [subscriptions.id],
  }),
  leaderEvent: one(leaderEvents, {
    fields: [mirrorIntents.leaderEventId],
    references: [leaderEvents.id],
  }),
  executions: many(executions),
}));

export const executionsRelations = relations(executions, ({ one }) => ({
  intent: one(mirrorIntents, {
    fields: [executions.mirrorIntentId],
    references: [mirrorIntents.id],
  }),
}));
