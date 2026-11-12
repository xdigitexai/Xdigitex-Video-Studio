import { requireAdmin } from "@/lib/server/context";
import { customerDetail, listCustomers } from "@/lib/server/admin";
import { getWallet, listLedger } from "@/lib/server/credits";
import { getEntitlements } from "@/lib/server/plans";
import { errorResponse, json } from "@/lib/server/http";
import { clampInt } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const [detail, wallet, ledger, entitlements] = await Promise.all([
        customerDetail(db, id),
        getWallet(db, id),
        listLedger(db, id, 40),
        getEntitlements(db, id),
      ]);
      return json({ detail, wallet, ledger, entitlements });
    }
    const customers = await listCustomers(db, {
      search: url.searchParams.get("search") || undefined,
      limit: clampInt(url.searchParams.get("limit"), 1, 200, 50),
      offset: clampInt(url.searchParams.get("offset"), 0, 100000, 0),
    });
    return json({ customers });
  } catch (error) {
    return errorResponse(error);
  }
}
