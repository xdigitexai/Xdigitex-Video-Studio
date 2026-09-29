ALTER TABLE `projects` ADD `overlay_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `selected_asset_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `caption_enabled` integer DEFAULT 1 NOT NULL;