import { auditRequest, guardMutation, requireUser } from "@/lib/server/context";
import { cancelSubscription, latestSubscription, resumeSubscription, refreshSubscription } from "@/lib/server/plans";
import { getPricingSettings } from "@/lib/server/settings";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    await guardMutation(request, db, "subscription-manage", 10, 60_000);
    const body = await readJson<{ action?: string }>(request);
    const settings = await getPricingSettings(db);
    const subscription = await latestSubscription(db, actor.user.id);
    if (!subscription) throw new ApiError(404, "No subscription found.", "SUBSCRIPTION_NOT_FOUND");
    await refreshSubscription(db, subscription, settings.grace_period_days);
    const current = (await latestSubscription(db, actor.user.id))!;
    if (current.status === "expired" || current.status === "canceled") {
      throw new ApiError(409, "This subscription has ended. Choose a plan to resubscribe.", "SUBSCRIPTION_ENDED");
    }
    if (body.action === "resume") {
      await resumeSubscription(db, current);
      await auditRequest(db, request, actor, "subscription.resumed", "subscription", current.id);
      return json({ ok: true, cancelAtPeriodEnd: false });
    }
    if (body.action === "cancel") {
      await cancelSubscription(db, current);
      await auditRequest(db, request, actor, "subscription.cancel_scheduled", "subscription", current.id);
      return json({ ok: true, cancelAtPeriodEnd: true, periodEnd: current.current_period_end });
    }
    throw new ApiError(400, "Unknown subscription action.", "INVALID_ACTION");
  } catch (error) {
    return errorResponse(error);
  }
}
