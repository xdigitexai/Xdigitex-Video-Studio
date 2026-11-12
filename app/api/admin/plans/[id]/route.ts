import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { getPlan } from "@/lib/server/plans";
import { replacePlanModels } from "@/lib/server/admin-plans";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-plan-update", 40, 60_000);
    const { id } = await params;
    const plan = await getPlan(db, id);
    if (!plan) throw new ApiError(404, "Plan not found.", "PLAN_NOT_FOUND");
    const body = await readJson<Record<string, unknown>>(request);
    const updates: Record<string, unknown> = { updated_at: now(), version: plan.version + 1 };
    if (typeof body.name === "string") {
      const name = safeString(body.name, 60);
      if (!name) throw new ApiError(400, "Plan name cannot be empty.", "INVALID_NAME");
      updates.name = name;
    }
    if (typeof body.description === "string") updates.description = body.description.slice(0, 300);
    if (body.priceCents !== undefined) updates.price_cents = clampInt(body.priceCents, 0, 10_000_000, plan.price_cents);
    if (body.creditsPerPeriod !== undefined) {
      updates.credits_per_period = clampInt(body.creditsPerPeriod, 0, 10_000_000, plan.credits_per_period);
    }
    if (body.videoLimit !== undefined) updates.video_limit = clampInt(body.videoLimit, -1, 1_000_000, plan.video_limit);
    if (body.imageLimit !== undefined) updates.image_limit = clampInt(body.imageLimit, -1, 1_000_000, plan.image_limit);
    if (body.maxVideoDurationSeconds !== undefined) {
      updates.max_video_duration_seconds = clampInt(body.maxVideoDurationSeconds, 1, 300, plan.max_video_duration_seconds);
    }
    if (Array.isArray(body.resolutions)) {
      updates.resolutions = JSON.stringify(body.resolutions.slice(0, 10).map((value) => String(value).slice(0, 20)));
    }
    if (body.queuePriority !== undefined) updates.queue_priority = clampInt(body.queuePriority, 0, 100, plan.queue_priority);
    if (body.maxConcurrentJobs !== undefined) {
      updates.max_concurrent_jobs = clampInt(body.maxConcurrentJobs, 1, 100, plan.max_concurrent_jobs);
    }
    if (body.storageLimitMb !== undefined) {
      updates.storage_limit_mb = clampInt(body.storageLimitMb, 0, 1_000_000, plan.storage_limit_mb);
    }
    if (Array.isArray(body.premiumFeatures)) {
      updates.premium_features = JSON.stringify(body.premiumFeatures.slice(0, 20).map(String));
    }
    if (typeof body.isActive === "boolean") updates.is_active = body.isActive ? 1 : 0;
    if (body.sortOrder !== undefined) updates.sort_order = clampInt(body.sortOrder, 0, 1000, plan.sort_order);

    const columns = Object.keys(updates);
    await db.run(
      `UPDATE plans SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...Object.values(updates), id] as Array<string | number | null>,
    );
    await replacePlanModels(db, id, Array.isArray(body.modelIds) ? (body.modelIds as string[]) : undefined);
    await auditRequest(db, request, actor, "admin.plan_updated", "plan", id, {
      version: plan.version + 1,
    });
    return json({ ok: true, version: plan.version + 1 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-plan-delete", 10, 60_000);
    const { id } = await params;
    const plan = await getPlan(db, id);
    if (!plan) throw new ApiError(404, "Plan not found.", "PLAN_NOT_FOUND");
    const subscriptions = await db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM subscriptions WHERE plan_id = ?`,
      [id],
    );
    const payments = await db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM payments WHERE plan_id = ?`, [id]);
    if ((subscriptions?.count ?? 0) > 0 || (payments?.count ?? 0) > 0) {
      throw new ApiError(
        409,
        "This plan has subscription or payment history. Deactivate it instead of deleting.",
        "PLAN_IN_USE",
      );
    }
    await db.batch([
      { sql: `DELETE FROM plan_models WHERE plan_id = ?`, params: [id] },
      { sql: `DELETE FROM plans WHERE id = ?`, params: [id] },
    ]);
    await auditRequest(db, request, actor, "admin.plan_deleted", "plan", id, { code: plan.code });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
