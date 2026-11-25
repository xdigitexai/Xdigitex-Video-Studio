import { requireUser } from "@/lib/server/context";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

interface CreditPackageView {
  id: string;
  code: string;
  name: string;
  credits: number;
  bonusCredits: number;
  priceCents: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
}

/** Customer-visible active top-up packages. Checkout remains server-side. */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);
    const rows = await db.all<{
      id: string;
      code: string;
      name: string;
      credits: number;
      bonus_credits: number;
      price_cents: number;
      currency: string;
      is_active: number;
      sort_order: number;
    }>(
      `SELECT id, code, name, credits, bonus_credits, price_cents, currency, is_active, sort_order
       FROM credit_packages WHERE is_active = 1 ORDER BY sort_order ASC, price_cents ASC`,
    );
    const packages: CreditPackageView[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      credits: row.credits,
      bonusCredits: row.bonus_credits,
      priceCents: row.price_cents,
      currency: row.currency,
      isActive: row.is_active === 1,
      sortOrder: row.sort_order,
    }));
    return json({ packages });
  } catch (error) {
    return errorResponse(error);
  }
}
