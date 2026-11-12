import { requireAdmin } from "@/lib/server/context";
import { exportGenerationsCsv, exportPaymentsCsv, filtersFromSearchParams } from "@/lib/server/admin";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const url = new URL(request.url);
    const filters = filtersFromSearchParams(url.searchParams);
    const type = url.searchParams.get("type") === "generations" ? "generations" : "payments";
    const csv = type === "generations" ? await exportGenerationsCsv(db, filters) : await exportPaymentsCsv(db, filters);
    const filename = `xdigitex-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
