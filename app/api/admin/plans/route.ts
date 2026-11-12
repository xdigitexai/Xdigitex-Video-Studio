import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { listPlans, toPlanView } from "@/lib/server/plans";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { clampInt, newId, now, safeString } from "@/lib/server/util";
import { replacePlanModels } from "@/lib/server/admin-plans";

export const dynamic = "force-dynamic";

interface PlanBody {
  code?: string;
  name?: string;
  description?: string;
  priceCents?: number;
  creditsPerPeriod?: number;
  videoLimit?: number;
  imageLimit?: number;
  maxVideoDurationSeconds?: number;
  resolutions?: string[];
  queuePriority?: number;
  maxConcurrentJobs?: number;
  storageLimitMb?: number;
  premiumFeatures?: string[];
  isActive?: boolean;
  sortOrder?: number;
  modelIds?: string[];
}

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const plans = await listPlans(db);
    const links = await db.all<{ plan_id: string; model_id: string }>(`SELECT plan_id, model_id FROM plan_models`);
    return json({
      plans: plans.map((plan) => ({
        ...toPlanView(plan),
        modelIds: links.filter((link) => link.plan_id === plan.id).map((link) => link.model_id),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-plan-create", 20, 60_000);
    const body = await readJson<PlanBody>(request);
    const code = safeString(body.code, 32).toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(code)) {
      throw new ApiError(400, "Plan code must be 2-32 lowercase letters, numbers, dash or underscore.", "INVALID_CODE");
    }
    const existing = await db.first<{ id: string }>(`SELECT id FROM plans WHERE code = ? LIMIT 1`, [code]);
    if (existing) throw new ApiError(409, "A plan with this code already exists.", "CODE_IN_USE");
    const name = safeString(body.name, 60);
    if (!name) throw new ApiError(400, "Plan name is required.", "INVALID_NAME");
    const priceCents = clampInt(body.priceCents, 0, 10_000_000, 0);
    const timestamp = now();
    const id = newId("plan");
    await db.run(
      `INSERT INTO plans (id, code, name, description, price_cents, currency, interval_months, credits_per_period,
         video_limit, image_limit, max_video_duration_seconds, resolutions, queue_priority, max_concurrent_jobs,
         storage_limit_mb, premium_features, is_active, sort_order, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'USD', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        code,
        name,
        safeString(body.description, 300),
        priceCents,
        clampInt(body.creditsPerPeriod, 0, 10_000_000, 0),
        clampInt(body.videoLimit, -1, 1_000_000, 0),
        clampInt(body.imageLimit, -1, 1_000_000, 0),
        clampInt(body.maxVideoDurationSeconds, 1, 300, 10),
        JSON.stringify(Array.isArray(body.resolutions) ? body.resolutions.slice(0, 10).map((value) => String(value).slice(0, 20)) : []),
        clampInt(body.queuePriority, 0, 100, 5),
        clampInt(body.maxConcurrentJobs, 1, 100, 1),
        clampInt(body.storageLimitMb, 0, 1_000_000, 2048),
        JSON.stringify(Array.isArray(body.premiumFeatures) ? body.premiumFeatures.slice(0, 20).map(String) : []),
        body.isActive === false ? 0 : 1,
        clampInt(body.sortOrder, 0, 1000, 0),
        timestamp,
        timestamp,
      ],
    );
    await replacePlanModels(db, id, body.modelIds);
    await auditRequest(db, request, actor, "admin.plan_created", "plan", id, { code, priceCents });
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
