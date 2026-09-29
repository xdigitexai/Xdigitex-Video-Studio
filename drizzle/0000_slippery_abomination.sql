CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`kind` text DEFAULT 'source' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_object_key_unique` ON `assets` (`object_key`);--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`provider_task_id` text NOT NULL,
	`status` text NOT NULL,
	`mode` text DEFAULT 'generate' NOT NULL,
	`prompt` text NOT NULL,
	`duration` integer NOT NULL,
	`aspect` text NOT NULL,
	`output_asset_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`aspect` text DEFAULT '16:9' NOT NULL,
	`duration` integer DEFAULT 5 NOT NULL,
	`trim_start` integer DEFAULT 0 NOT NULL,
	`trim_end` integer DEFAULT 0 NOT NULL,
	`captions` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
