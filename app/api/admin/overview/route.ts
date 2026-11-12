import { requireAdmin } from "@/lib/server/context";
import { adminOverview, filtersFromSearchParams, modelPerformance, providerPerformance, revenueSeries } from "@/lib/server/admin";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const filters = filtersFromSearchParams(new URL(request.url).searchParams);
    const [kpis, providers, series, models] = await Promise.all([
      adminOverview(db, filters),
      providerPerformance(db, filters),
      revenueSeries(db, filters),
      modelPerformance(db, filters),
    ]);
    return json({ kpis, providers, series, models, filters });
  } catch (error) {
    return errorResponse(error);
  }
}
