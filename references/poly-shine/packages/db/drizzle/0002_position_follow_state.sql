CREATE TABLE `position_follow_state` (
	`subscription_id` text NOT NULL,
	`asset` text NOT NULL,
	`state` text(24) DEFAULT 'untracked' NOT NULL,
	`abandoned_reason` text,
	`entry_leader_event_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `position_follow_state_sub_asset_unique` ON `position_follow_state` (`subscription_id`,`asset`);--> statement-breakpoint
CREATE INDEX `position_follow_state_sub_idx` ON `position_follow_state` (`subscription_id`);
