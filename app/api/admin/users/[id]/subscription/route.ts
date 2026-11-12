import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { activatePlan, getPlan } from "@/lib/server/plans";
import { grantCredits } from "@/lib/server/credits";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { DAY, newId, now } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** Administrative plan activation (support, comps, manual renewals). Auditable. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-subscription-activate", 20, 60_000);
    const { id } = await params;
    const user = await db.first<{ id: string }>(`SELECT id FROM users WHERE id = ?`, [id]);
    if (!user) throw new ApiError(404, "User not found.", "USER_NOT_FOUND");
    const body = await readJson<{ planId?: string; months?: number; grantCredits?: boolean; reason?: string }>(request);
    const plan = await getPlan(db, String(body.planId ?? ""));
    if (!plan) throw new ApiError(404, "Plan not found.", "PLAN_NOT_FOUND");
    const months = Math.min(24, Math.max(1, Math.round(Number(body.months ?? 1))));
    const activation = await activatePlan(db, {
      userId: id,
      planId: plan.id,
      months,
      paymentId: null,
    });
    let creditsGranted = 0;
    if (body.grantCredits !== false) {
      const reference = `admin-comp:${newId("sub")}`;
      const applied = await grantCredits(db, {
        userId: id,
        credits: plan.credits_per_period,
        source: "promo",
        sourceId: activation.subscription.id,
        reference,
        description: `Admin activation: ${plan.name}`,
        expiresAt: activation.periodEnd + 30 * DAY,
        bumpLifetime: "granted",
      });
      if (applied) creditsGranted = plan.credits_per_period;
    }
    await auditRequest(db, request, actor, "admin.subscription_activated", "subscription", activation.subscription.id, {
      userId: id,
      planId: plan.id,
      months,
      creditsGranted,
      reason: body.reason ?? "",
      manual: true,
    });
    return json({
      ok: true,
      subscription: activation.subscription,
      periodStart: activation.periodStart,
      periodEnd: activation.periodEnd,
      creditsGranted,
      grantedAt: now(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
