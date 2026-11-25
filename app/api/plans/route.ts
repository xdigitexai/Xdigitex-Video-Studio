import { requireUser } from "@/lib/server/context";
import { errorResponse, json } from "@/lib/server/http";
import { listPlans, toPlanView } from "@/lib/server/plans";

export const dynamic = "force-dynamic";

/** Customer-visible active plans. Used by the native clients for display only. */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);
    const plans = await listPlans(db, { activeOnly: true });
    return json({ plans: plans.map(toPlanView) });
  } catch (error) {
    return errorResponse(error);
  }
}
