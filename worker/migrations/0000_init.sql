CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_logs_org_created_idx` ON `audit_logs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`honorific` text DEFAULT '御中' NOT NULL,
	`contact_name` text,
	`phone` text,
	`email` text,
	`postal_code` text,
	`address` text,
	`notes` text,
	`telkal_customer_id` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_id_org_uq` ON `customers` (`id`,`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_telkal_uq` ON `customers` (`organization_id`,`telkal_customer_id`);--> statement-breakpoint
CREATE INDEX `customers_org_name_idx` ON `customers` (`organization_id`,`archived_at`,`name`);--> statement-breakpoint
CREATE TABLE `estimate_items` (
	`id` text PRIMARY KEY NOT NULL,
	`estimate_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`position` integer NOT NULL,
	`price_item_id` text,
	`name` text NOT NULL,
	`spec` text,
	`quantity_milli` integer NOT NULL,
	`unit` text,
	`unit_price_x100` integer NOT NULL,
	`amount_yen` integer NOT NULL,
	`tax_category` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`estimate_id`,`organization_id`) REFERENCES `estimates`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "estimate_items_tax_ck" CHECK("estimate_items"."tax_category" IN ('standard', 'reduced', 'exempt'))
);
--> statement-breakpoint
CREATE INDEX `estimate_items_estimate_idx` ON `estimate_items` (`estimate_id`,`position`);--> statement-breakpoint
CREATE TABLE `estimate_number_counters` (
	`organization_id` text NOT NULL,
	`period` text NOT NULL,
	`last_value` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `period`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `estimate_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`estimate_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`event` text NOT NULL,
	`status` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`estimate_id`,`organization_id`) REFERENCES `estimates`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `estimate_revisions_estimate_idx` ON `estimate_revisions` (`estimate_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`estimate_number` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` text NOT NULL,
	`valid_until` text,
	`customer_id` text,
	`recipient_name` text DEFAULT '' NOT NULL,
	`recipient_honorific` text DEFAULT '御中' NOT NULL,
	`recipient_contact` text,
	`recipient_address` text,
	`subject` text DEFAULT '' NOT NULL,
	`project_name` text,
	`project_location` text,
	`notes` text,
	`discount_yen` integer DEFAULT 0 NOT NULL,
	`subtotal_yen` integer DEFAULT 0 NOT NULL,
	`tax_yen` integer DEFAULT 0 NOT NULL,
	`total_yen` integer DEFAULT 0 NOT NULL,
	`tax_summary` text DEFAULT '[]' NOT NULL,
	`amount_rounding` text NOT NULL,
	`tax_rounding` text NOT NULL,
	`issuer_snapshot` text,
	`root_estimate_id` text,
	`revision_number` integer DEFAULT 0 NOT NULL,
	`revised_from_id` text,
	`duplicated_from_id` text,
	`issued_at` text,
	`created_by` text,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`,`organization_id`) REFERENCES `customers`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "estimates_status_ck" CHECK("estimates"."status" IN ('draft', 'issued', 'won', 'lost')),
	CONSTRAINT "estimates_discount_ck" CHECK("estimates"."discount_yen" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estimates_id_org_uq` ON `estimates` (`id`,`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimates_org_number_uq` ON `estimates` (`organization_id`,`estimate_number`);--> statement-breakpoint
CREATE INDEX `estimates_org_issue_idx` ON `estimates` (`organization_id`,`deleted_at`,`issue_date`);--> statement-breakpoint
CREATE INDEX `estimates_org_updated_idx` ON `estimates` (`organization_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `estimates_org_created_idx` ON `estimates` (`organization_id`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `estimates_org_status_idx` ON `estimates` (`organization_id`,`deleted_at`,`status`);--> statement-breakpoint
CREATE INDEX `estimates_org_root_idx` ON `estimates` (`organization_id`,`root_estimate_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization_logos` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `logos_id_org_uq` ON `organization_logos` (`id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `logos_org_idx` ON `organization_logos` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memberships_role_ck" CHECK("organization_memberships"."role" IN ('admin', 'member')),
	CONSTRAINT "memberships_status_ck" CHECK("organization_memberships"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_user_id_unique` ON `organization_memberships` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_user_uq` ON `organization_memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organization_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`postal_code` text,
	`address` text,
	`phone` text,
	`email` text,
	`bank_info` text,
	`registration_number` text,
	`logo_id` text,
	`number_prefix` text DEFAULT '{YYYY}-' NOT NULL,
	`number_digits` integer DEFAULT 4 NOT NULL,
	`number_reset` text DEFAULT 'yearly' NOT NULL,
	`amount_rounding` text DEFAULT 'floor' NOT NULL,
	`tax_rounding` text DEFAULT 'floor' NOT NULL,
	`default_notes` text,
	`default_valid_days` integer DEFAULT 30 NOT NULL,
	`member_can_edit_prices` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`logo_id`,`organization_id`) REFERENCES `organization_logos`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_categories_id_org_uq` ON `price_categories` (`id`,`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `price_categories_org_name_uq` ON `price_categories` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `price_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`category_id` text,
	`spec` text,
	`unit` text,
	`unit_price_x100` integer NOT NULL,
	`tax_category` text DEFAULT 'standard' NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`,`organization_id`) REFERENCES `price_categories`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_items_tax_ck" CHECK("price_items"."tax_category" IN ('standard', 'reduced', 'exempt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_items_org_code_uq` ON `price_items` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `price_items_org_active_name_idx` ON `price_items` (`organization_id`,`is_active`,`name`);--> statement-breakpoint
CREATE INDEX `price_items_org_category_idx` ON `price_items` (`organization_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `price_items_org_price_idx` ON `price_items` (`organization_id`,`unit_price_x100`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_key_unique` ON `rate_limits` (`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);