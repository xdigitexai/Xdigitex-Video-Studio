CREATE INDEX `assets_project_created_idx` ON `assets` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assets_owner_idx` ON `assets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `generations_project_created_idx` ON `generations` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `projects_owner_updated_idx` ON `projects` (`owner_id`,`updated_at`);