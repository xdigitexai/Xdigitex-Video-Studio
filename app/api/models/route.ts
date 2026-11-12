import { requireUser } from "@/lib/server/context";
import { getEntitlements } from "@/lib/server/plans";
import { listCustomerModels, publicModel } from "@/lib/server/models";
import { errorResponse, json } from "@/lib/server/http";
import { CAPABILITIES, type Capability } from "@/lib/server/providers/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    const url = new URL(request.url);
    const requested = url.searchParams.get("capability") || "";
    const capability = (CAPABILITIES as readonly string[]).includes(requested)
      ? (requested as Capability)
      : undefined;
    const entitlements = await getEntitlements(db, actor.user.id);
    const models = await listCustomerModels(db, {
      capability,
      planModelIds: entitlements.plan ? entitlements.modelIds : [],
    });
    return json({
      models: models.map((model) => publicModel(model, { planAllowed: model.planAllowed })),
      plan: entitlements.plan ? { id: entitlements.plan.id, name: entitlements.plan.name } : null,
      subscriptionStatus: entitlements.status,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
