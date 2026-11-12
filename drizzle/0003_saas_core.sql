CREATE TABLE `ai_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`code` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`pricing_unit` text DEFAULT 'per_request' NOT NULL,
	`unit_cost_micros` integer DEFAULT 0 NOT NULL,
	`min_charge_micros` integer DEFAULT 0 NOT NULL,
	`pricing_meta` text DEFAULT '{}' NOT NULL,
	`max_duration_seconds` integer DEFAULT 10 NOT NULL,
	`resolutions` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`is_default_video` integer DEFAULT 0 NOT NULL,
	`is_default_image` integer DEFAULT 0 NOT NULL,
	`is_estimated` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_provider_code_unique` ON `ai_models` (`provider_id`,`code`);--> statement-breakpoint
CREATE INDEX `ai_models_active_idx` ON `ai_models` (`is_active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'unconfigured' NOT NULL,
	`last_checked_at` integer,
	`last_error` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_code_unique` ON `ai_providers` (`code`);--> statement-breakpoint
CREATE TABLE `api_rate_limits` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_email` text,
	`action` text NOT NULL,
	`target_type` text DEFAULT '' NOT NULL,
	`target_id` text DEFAULT '' NOT NULL,
	`ip` text,
	`user_agent` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_hash_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_kind_idx` ON `auth_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `credit_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`credits` integer NOT NULL,
	`remaining` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credit_grants_user_idx` ON `credit_grants` (`user_id`,`status`,`expires_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reference` text NOT NULL,
	`generation_id` text,
	`payment_id` text,
	`description` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_reference_unique` ON `credit_ledger` (`reference`);--> statement-breakpoint
CREATE INDEX `credit_ledger_user_idx` ON `credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_ledger_generation_idx` ON `credit_ledger` (`generation_id`);--> statement-breakpoint
CREATE TABLE `credit_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`credits` integer NOT NULL,
	`bonus_credits` integer DEFAULT 0 NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_packages_code_unique` ON `credit_packages` (`code`);--> statement-breakpoint
CREATE TABLE `credit_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`amount` integer NOT NULL,
	`settled_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	`released_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_reservations_generation_unique` ON `credit_reservations` (`generation_id`);--> statement-breakpoint
CREATE INDEX `credit_reservations_user_idx` ON `credit_reservations` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `credit_wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`lifetime_purchased` integer DEFAULT 0 NOT NULL,
	`lifetime_granted` integer DEFAULT 0 NOT NULL,
	`lifetime_consumed` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`to_email` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_message_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `email_outbox_status_idx` ON `email_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `generation_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`unit_kind` text DEFAULT 'request' NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`actual_cost_micros` integer,
	`provider_reference` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `generation_usage_generation_idx` ON `generation_usage` (`generation_id`);--> statement-breakpoint
CREATE INDEX `generation_usage_provider_idx` ON `generation_usage` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`signature_valid` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_key_unique` ON `payment_events` (`event_key`);--> statement-breakpoint
CREATE INDEX `payment_events_payment_idx` ON `payment_events` (`payment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reference` text NOT NULL,
	`purpose` text NOT NULL,
	`provider` text DEFAULT 'xdigitex_pay' NOT NULL,
	`plan_id` text,
	`package_id` text,
	`subscription_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'KES' NOT NULL,
	`price_usd_cents` integer DEFAULT 0 NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_checkout_id` text,
	`provider_receipt` text,
	`phone_number` text,
	`failure_reason` text,
	`fulfillment_error` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`refunded_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_reference_unique` ON `payments` (`reference`);--> statement-breakpoint
CREATE INDEX `payments_user_created_idx` ON `payments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_checkout_idx` ON `payments` (`provider_checkout_id`);--> statement-breakpoint
CREATE TABLE `plan_models` (
	`plan_id` text NOT NULL,
	`model_id` text NOT NULL,
	PRIMARY KEY(`plan_id`, `model_id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`interval_months` integer DEFAULT 1 NOT NULL,
	`credits_per_period` integer DEFAULT 0 NOT NULL,
	`video_limit` integer DEFAULT 0 NOT NULL,
	`image_limit` integer DEFAULT 0 NOT NULL,
	`max_video_duration_seconds` integer DEFAULT 5 NOT NULL,
	`resolutions` text DEFAULT '["720p"]' NOT NULL,
	`queue_priority` integer DEFAULT 5 NOT NULL,
	`max_concurrent_jobs` integer DEFAULT 1 NOT NULL,
	`storage_limit_mb` integer DEFAULT 2048 NOT NULL,
	`premium_features` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_code_unique` ON `plans` (`code`);--> statement-breakpoint
CREATE INDEX `plans_active_idx` ON `plans` (`is_active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `pricing_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`user_id` text,
	`plan_id` text,
	`provider_id` text,
	`model_id` text,
	`generation_type` text,
	`margin_bps` integer,
	`fixed_price_micros` integer,
	`min_charge_micros` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pricing_overrides_lookup_idx` ON `pricing_overrides` (`is_active`,`user_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `pricing_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_margin_bps` integer DEFAULT 4000 NOT NULL,
	`min_charge_micros` integer DEFAULT 100000 NOT NULL,
	`credit_value_micros` integer DEFAULT 10000 NOT NULL,
	`usd_to_kes_rate_micros` integer DEFAULT 130000000 NOT NULL,
	`grace_period_days` integer DEFAULT 3 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`capability` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`unit_kind` text DEFAULT 'request' NOT NULL,
	`provider_cost_micros` integer NOT NULL,
	`margin_bps` integer NOT NULL,
	`selling_price_micros` integer NOT NULL,
	`credits_charged` integer NOT NULL,
	`credit_value_micros` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`estimated` integer DEFAULT 1 NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`applied_rule` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_snapshots_generation_unique` ON `pricing_snapshots` (`generation_id`);--> statement-breakpoint
CREATE INDEX `pricing_snapshots_user_idx` ON `pricing_snapshots` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`label` text DEFAULT 'default' NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE INDEX `provider_credentials_provider_idx` ON `provider_credentials` (`provider_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `provider_error_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`model_id` text,
	`generation_id` text,
	`http_status` integer,
	`code` text,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_errors_provider_idx` ON `provider_error_events` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subscription_events_sub_idx` ON `subscription_events` (`subscription_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_start` integer NOT NULL,
	`current_period_end` integer NOT NULL,
	`cancel_at_period_end` integer DEFAULT 0 NOT NULL,
	`grace_ends_at` integer,
	`pending_plan_id` text,
	`plan_change_effective_at` integer,
	`price_cents_snapshot` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`canceled_at` integer
);
--> statement-breakpoint
CREATE INDEX `subscriptions_user_status_idx` ON `subscriptions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `subscriptions_period_idx` ON `subscriptions` (`status`,`current_period_end`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`password_hash` text,
	`display_name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'customer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email_verified_at` integer,
	`legacy_owner_id` text,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_normalized_unique` ON `users` (`email_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_legacy_owner_unique` ON `users` (`legacy_owner_id`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_created_idx` ON `users` (`created_at`);--> statement-breakpoint
ALTER TABLE `generations` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `capability` text DEFAULT 'text_to_video' NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `settings` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `progress` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `credits_reserved` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `credits_charged` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `pricing_snapshot_id` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `billing_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `submitted_at` integer;--> statement-breakpoint
ALTER TABLE `generations` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `generations` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `generations_owner_created_idx` ON `generations` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generations_status_idx` ON `generations` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `generations_idempotency_unique` ON `generations` (`idempotency_key`);