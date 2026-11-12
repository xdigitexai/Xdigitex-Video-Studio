import { getWallet } from "@/lib/server/credits";
import { getEntitlements } from "@/lib/server/plans";
import { contextFromRequest } from "@/lib/server/context";
import { errorResponse, json } from "@/lib/server/http";
import { publicUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, actor } = await contextFromRequest(request);
    if (!actor) return json({ user: null }, 200);
    const [wallet, entitlements] = await Promise.all([
      getWallet(db, actor.user.id),
      getEntitlements(db, actor.user.id),
    ]);
    return json({
      user: publicUser(actor.user),
      wallet,
      plan: entitlements.plan ? { id: entitlements.plan.id, name: entitlements.plan.name, code: entitlements.plan.code } : null,
      subscriptionStatus: entitlements.status,
      periodEnd: entitlements.periodEnd,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
