CREATE TABLE IF NOT EXISTS `engine_state` (
  `id` integer PRIMARY KEY NOT NULL,
  `paused` integer NOT NULL DEFAULT 0,
  `mode` text NOT NULL DEFAULT 'read_only',
  `cancel_all_on_kill` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `engine_state` (`id`, `paused`, `mode`, `cancel_all_on_kill`, `updated_at`)
VALUES (1, 0, 'read_only', 0, (datetime('now')));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `watched_wallets` (
  `id` text PRIMARY KEY NOT NULL,
  `address` text NOT NULL,
  `label` text,
  `active` integer NOT NULL DEFAULT 1,
  `last_trade_timestamp` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `watched_wallets_address_unique` ON `watched_wallets` (`address`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `watched_wallet_id` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `sizing_mode` text NOT NULL,
  `fixed_usd` text,
  `pct_balance` text,
  `pct_leader_notional` text,
  `max_notional_per_trade` text,
  `max_open_exposure_usd` text,
  `max_daily_loss_usd` text,
  `max_orders_per_second` integer DEFAULT 5,
  `max_slippage_bps` integer DEFAULT 150,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`watched_wallet_id`) REFERENCES `watched_wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `subscriptions_wallet_idx` ON `subscriptions` (`watched_wallet_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `leader_events` (
  `id` text PRIMARY KEY NOT NULL,
  `watched_wallet_id` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `tx_hash` text,
  `asset` text NOT NULL,
  `condition_id` text,
  `side` text NOT NULL,
  `size` text NOT NULL,
  `price` text NOT NULL,
  `trade_timestamp` integer NOT NULL,
  `raw` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`watched_wallet_id`) REFERENCES `watched_wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `leader_events_dedupe_unique` ON `leader_events` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `leader_events_wallet_ts_idx` ON `leader_events` (`watched_wallet_id`,`trade_timestamp`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mirror_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `subscription_id` text NOT NULL,
  `leader_event_id` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `skip_reason` text,
  `planned` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`leader_event_id`) REFERENCES `leader_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mirror_intents_dedupe_unique` ON `mirror_intents` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mirror_intents_sub_idx` ON `mirror_intents` (`subscription_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `executions` (
  `id` text PRIMARY KEY NOT NULL,
  `mirror_intent_id` text NOT NULL,
  `success` integer NOT NULL,
  `raw` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`mirror_intent_id`) REFERENCES `mirror_intents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `executions_intent_idx` ON `executions` (`mirror_intent_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `balances_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `ref_address` text,
  `balance_usd` text,
  `raw` text,
  `snapshot_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pnl_rollups` (
  `id` text PRIMARY KEY NOT NULL,
  `period_start` text NOT NULL,
  `subscription_id` text,
  `pnl_usd` text NOT NULL,
  `meta` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pnl_rollups_period_idx` ON `pnl_rollups` (`period_start`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `action` text NOT NULL,
  `detail` text,
  `created_at` text NOT NULL
);
