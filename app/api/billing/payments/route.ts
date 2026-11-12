import { requireUser } from "@/lib/server/context";
import { listPayments, paymentView } from "@/lib/server/payments/service";
import { errorResponse, json } from "@/lib/server/http";
import { clampInt } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    const url = new URL(request.url);
    const payments = await listPayments(db, {
      userId: actor.user.id,
      limit: clampInt(url.searchParams.get("limit"), 1, 100, 30),
      offset: clampInt(url.searchParams.get("offset"), 0, 100000, 0),
    });
    return json({ payments: payments.map(paymentView) });
  } catch (error) {
    return errorResponse(error);
  }
}
