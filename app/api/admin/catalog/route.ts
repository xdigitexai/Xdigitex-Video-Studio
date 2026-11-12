import { requireAdmin } from "@/lib/server/context";
import { listModelRows, listProviders } from "@/lib/server/models";
import { listPlans, toPlanView } from "@/lib/server/plans";
import { ADAPTERS, providerCodes } from "@/lib/server/providers";
import { CAPABILITIES } from "@/lib/server/providers/types";
import { getPricingSettings } from "@/lib/server/settings";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const [providers, models, plans, packages, settings, users] = await Promise.all([
      listProviders(db),
      listModelRows(db),
      listPlans(db),
      db.all(`SELECT * FROM credit_packages ORDER BY sort_order ASC`),
      getPricingSettings(db),
      db.all<{ id: string; email: string; display_name: string }>(
        `SELECT id, email, display_name FROM users ORDER BY created_at DESC LIMIT 1000`,
      ),
    ]);
    return json({
      providers: providers.map((provider) => ({
        id: provider.id,
        code: provider.code,
        name: provider.name,
        isEnabled: provider.is_enabled === 1,
        status: provider.status,
        capabilities: ADAPTERS[provider.code]?.capabilities ?? [],
      })),
      models,
      plans: plans.map(toPlanView),
      packages,
      settings,
      users,
      capabilityOptions: CAPABILITIES,
      providerCodes: providerCodes(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
