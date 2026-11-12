import { requireUser } from "@/lib/server/context";
import { getWallet, listLedger } from "@/lib/server/credits";
import { errorResponse, json } from "@/lib/server/http";
import { clampInt } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, actor } = await requireUser(request);
    const url = new URL(request.url);
    const [wallet, entries] = await Promise.all([
      getWallet(db, actor.user.id),
      listLedger(db, actor.user.id, clampInt(url.searchParams.get("limit"), 1, 200, 50)),
    ]);
    return json({
      wallet,
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amount: entry.amount,
        balanceAfter: entry.balance_after,
        reference: entry.reference,
        description: entry.description,
        generationId: entry.generation_id,
        createdAt: entry.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
