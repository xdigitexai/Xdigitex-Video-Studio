-- Central platform administration: database-backed roles, fine-grained
-- permissions and optional TOTP MFA. Append-only and non-destructive: no user,
-- generation, subscription, payment or balance rows are modified or removed.
ALTER TABLE `users` ADD `mfa_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_secret` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `mfa_verified_at` integer;--> statement-breakpoint
CREATE TABLE `admin_permissions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_permissions_user_idx` ON `admin_permissions` (`user_id`);
