-- Merge watched_wallets into subscriptions (one leader per subscription).
ALTER TABLE `subscriptions` ADD COLUMN `address` text;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD COLUMN `label` text;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD COLUMN `last_trade_timestamp` integer;
--> statement-breakpoint
UPDATE `subscriptions` SET
  `address` = (SELECT lower(`w`.`address`) FROM `watched_wallets` `w` WHERE `w`.`id` = `subscriptions`.`watched_wallet_id`),
  `label` = (SELECT `w`.`label` FROM `watched_wallets` `w` WHERE `w`.`id` = `subscriptions`.`watched_wallet_id`),
  `last_trade_timestamp` = (SELECT `w`.`last_trade_timestamp` FROM `watched_wallets` `w` WHERE `w`.`id` = `subscriptions`.`watched_wallet_id`);
--> statement-breakpoint
DELETE FROM `subscriptions` WHERE `address` IS NULL;
--> statement-breakpoint
INSERT INTO `subscriptions` (
  `id`, `watched_wallet_id`, `active`, `sizing_mode`, `fixed_usd`,
  `max_notional_per_trade`, `max_orders_per_second`, `max_slippage_bps`,
  `created_at`, `updated_at`, `address`, `label`, `last_trade_timestamp`
)
SELECT
  `w`.`id`, `w`.`id`, `w`.`active`, 'fixed_usd', '25',
  '500', 5, 150, `w`.`created_at`, `w`.`updated_at`,
  lower(`w`.`address`), `w`.`label`, `w`.`last_trade_timestamp`
FROM `watched_wallets` `w`
WHERE NOT EXISTS (
  SELECT 1 FROM `subscriptions` `s` WHERE `s`.`watched_wallet_id` = `w`.`id`
);
--> statement-breakpoint
ALTER TABLE `leader_events` ADD COLUMN `subscription_id` text;
--> statement-breakpoint
UPDATE `leader_events` SET `subscription_id` = (
  SELECT `s`.`id` FROM `subscriptions` `s`
  WHERE `s`.`watched_wallet_id` = `leader_events`.`watched_wallet_id`
  ORDER BY `s`.`created_at` ASC
  LIMIT 1
);
--> statement-breakpoint
DELETE FROM `leader_events` WHERE `subscription_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `leader_events_new` (
  `id` text PRIMARY KEY NOT NULL,
  `subscription_id` text NOT NULL,
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
  FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `leader_events_new` (
  `id`, `subscription_id`, `dedupe_key`, `tx_hash`, `asset`, `condition_id`,
  `side`, `size`, `price`, `trade_timestamp`, `raw`, `created_at`
)
SELECT
  `id`, `subscription_id`, `dedupe_key`, `tx_hash`, `asset`, `condition_id`,
  `side`, `size`, `price`, `trade_timestamp`, `raw`, `created_at`
FROM `leader_events`;
--> statement-breakpoint
DROP TABLE `leader_events`;
--> statement-breakpoint
ALTER TABLE `leader_events_new` RENAME TO `leader_events`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `leader_events_dedupe_unique` ON `leader_events` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `leader_events_sub_ts_idx` ON `leader_events` (`subscription_id`,`trade_timestamp`);
--> statement-breakpoint
CREATE TABLE `subscriptions_new` (
  `id` text PRIMARY KEY NOT NULL,
  `address` text NOT NULL,
  `label` text,
  `active` integer NOT NULL DEFAULT 1,
  `last_trade_timestamp` integer,
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
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `subscriptions_new` (
  `id`, `address`, `label`, `active`, `last_trade_timestamp`, `sizing_mode`,
  `fixed_usd`, `pct_balance`, `pct_leader_notional`, `max_notional_per_trade`,
  `max_open_exposure_usd`, `max_daily_loss_usd`, `max_orders_per_second`,
  `max_slippage_bps`, `created_at`, `updated_at`
)
SELECT
  `id`, `address`, `label`, `active`, `last_trade_timestamp`, `sizing_mode`,
  `fixed_usd`, `pct_balance`, `pct_leader_notional`, `max_notional_per_trade`,
  `max_open_exposure_usd`, `max_daily_loss_usd`, `max_orders_per_second`,
  `max_slippage_bps`, `created_at`, `updated_at`
FROM `subscriptions`;
--> statement-breakpoint
DROP TABLE `subscriptions`;
--> statement-breakpoint
ALTER TABLE `subscriptions_new` RENAME TO `subscriptions`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `subscriptions_address_unique` ON `subscriptions` (`address`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `subscriptions_active_idx` ON `subscriptions` (`active`);
--> statement-breakpoint
DROP TABLE IF EXISTS `watched_wallets`;
