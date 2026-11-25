import { requireUser } from "@/lib/server/context";
import { errorResponse, json } from "@/lib/server/http";
import { getEntitlements } from "@/lib/server/plans";

export const dynamic = "force-dynamic";

/** Existing plan limits and current cycle usage for the signed-in user. */
export async function GET(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    const entitlements = await getEntitlements(db, actor.user.id);
    return json({
      limits: entitlements.limits,
      usage: entitlements.usage,
      status: entitlements.status,
      periodStart: entitlements.periodStart,
      periodEnd: entitlements.periodEnd,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
