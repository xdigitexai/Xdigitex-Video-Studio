import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull().default(""),
  aspect: text("aspect").notNull().default("16:9"),
  duration: integer("duration").notNull().default(5),
  trimStart: integer("trim_start").notNull().default(0),
  trimEnd: integer("trim_end").notNull().default(0),
  overlayTitle: text("overlay_title").notNull().default(""),
  selectedAssetId: text("selected_asset_id"),
  captionEnabled: integer("caption_enabled").notNull().default(1),
  captions: text("captions").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  kind: text("kind").notNull().default("source"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("assets_project_created_idx").on(table.projectId, table.createdAt), index("assets_owner_idx").on(table.ownerId)]);

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  providerTaskId: text("provider_task_id").notNull(),
  status: text("status").notNull(),
  mode: text("mode").notNull().default("generate"),
  prompt: text("prompt").notNull(),
  duration: integer("duration").notNull(),
  aspect: text("aspect").notNull(),
  outputAssetId: text("output_asset_id"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("generations_project_created_idx").on(table.projectId, table.createdAt)]);
