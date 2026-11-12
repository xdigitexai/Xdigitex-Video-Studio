import { requireAdmin } from "@/lib/server/context";
import { listPayments, paymentView } from "@/lib/server/payments/service";
import { filtersFromSearchParams } from "@/lib/server/admin";
import { errorResponse, json } from "@/lib/server/http";
import { clampInt } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const url = new URL(request.url);
    const filters = filtersFromSearchParams(url.searchParams);
    const payments = await listPayments(db, {
      userId: filters.userId,
      status: url.searchParams.get("status") || undefined,
      since: filters.since,
      until: filters.until,
      limit: clampInt(url.searchParams.get("limit"), 1, 200, 50),
      offset: clampInt(url.searchParams.get("offset"), 0, 100000, 0),
    });
    const rows = await Promise.all(
      payments.map(async (payment) => ({
        ...paymentView(payment),
        userId: payment.user_id,
        user: await db.first<{ email: string; display_name: string }>(
          `SELECT email, display_name FROM users WHERE id = ?`,
          [payment.user_id],
        ),
        fulfillmentError: payment.fulfillment_error,
        checkoutRequestId: payment.provider_checkout_id,
      })),
    );
    return json({ payments: rows });
  } catch (error) {
    return errorResponse(error);
  }
}
