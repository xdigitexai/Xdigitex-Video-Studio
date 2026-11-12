import type { Db } from "./db";

export interface ProjectCard {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  assetCount: number;
  generationCount: number;
  thumbId: string | null;
  thumbType: string | null;
}

export async function listProjectCards(db: Db, userId: string, limit = 100): Promise<ProjectCard[]> {
  const rows = await db.all<{
    id: string;
    name: string;
    updated_at: number;
    created_at: number;
    asset_count: number;
    generation_count: number;
    thumb_id: string | null;
    thumb_type: string | null;
  }>(
    `SELECT p.id, p.name, p.updated_at, p.created_at,
       (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count,
       (SELECT COUNT(*) FROM generations g WHERE g.project_id = p.id) AS generation_count,
       (SELECT a.id FROM assets a WHERE a.project_id = p.id ORDER BY a.created_at DESC LIMIT 1) AS thumb_id,
       (SELECT a.content_type FROM assets a WHERE a.project_id = p.id ORDER BY a.created_at DESC LIMIT 1) AS thumb_type
     FROM projects p WHERE p.owner_id = ? ORDER BY p.updated_at DESC LIMIT ?`,
    [userId, Math.min(200, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    assetCount: row.asset_count,
    generationCount: row.generation_count,
    thumbId: row.thumb_id,
    thumbType: row.thumb_type,
  }));
}

export interface MediaItem {
  id: string;
  projectId: string;
  projectName: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  kind: string;
  createdAt: number;
}

export async function listUserMedia(db: Db, userId: string, limit = 120): Promise<MediaItem[]> {
  const rows = await db.all<{
    id: string;
    project_id: string;
    project_name: string;
    file_name: string;
    content_type: string;
    byte_size: number;
    kind: string;
    created_at: number;
  }>(
    `SELECT a.id, a.project_id, p.name AS project_name, a.file_name, a.content_type, a.byte_size, a.kind, a.created_at
     FROM assets a JOIN projects p ON p.id = a.project_id
     WHERE a.owner_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    [userId, Math.min(300, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    kind: row.kind,
    createdAt: row.created_at,
  }));
}

export async function projectAssetCount(db: Db, userId: string): Promise<number> {
  const row = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM assets WHERE owner_id = ?`, [userId]);
  return row?.count ?? 0;
}
