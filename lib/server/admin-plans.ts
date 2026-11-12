import type { Db } from "./db";
import { ApiError } from "./http";

export async function replacePlanModels(db: Db, planId: string, modelIds?: string[]): Promise<void> {
  if (!Array.isArray(modelIds)) return;
  const unique = [...new Set(modelIds.map(String))].slice(0, 200);
  if (unique.length) {
    const placeholders = unique.map(() => "?").join(",");
    const found = await db.all<{ id: string }>(`SELECT id FROM ai_models WHERE id IN (${placeholders})`, unique);
    if (found.length !== unique.length) {
      throw new ApiError(400, "One or more selected models do not exist.", "INVALID_MODEL");
    }
  }
  await db.run(`DELETE FROM plan_models WHERE plan_id = ?`, [planId]);
  for (const modelId of unique) {
    await db.run(`INSERT OR IGNORE INTO plan_models (plan_id, model_id) VALUES (?, ?)`, [planId, modelId]);
  }
}
