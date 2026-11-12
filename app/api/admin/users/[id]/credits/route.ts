import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { adjustCredits, getWallet } from "@/lib/server/credits";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { newId, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-credit-adjust", 30, 60_000);
    const { id } = await params;
    const user = await db.first<{ id: string }>(`SELECT id FROM users WHERE id = ?`, [id]);
    if (!user) throw new ApiError(404, "User not found.", "USER_NOT_FOUND");
    const body = await readJson<{ credits?: number; description?: string }>(request);
    const credits = Math.round(Number(body.credits));
    if (!Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 10_000_000) {
      throw new ApiError(400, "Enter a non-zero credit amount.", "INVALID_CREDITS");
    }
    const description = safeString(body.description, 200) || (credits > 0 ? "Admin credit grant" : "Admin credit adjustment");
    const applied = await adjustCredits(db, {
      userId: id,
      credits,
      reference: `admin-credit:${newId("adj")}`,
      description,
      actorId: actor.user.id,
    });
    if (!applied) {
      throw new ApiError(409, "The wallet does not have enough available credits for this deduction.", "INSUFFICIENT_CREDITS");
    }
    await auditRequest(db, request, actor, "admin.credits_adjusted", "user", id, { credits, description });
    return json({ ok: true, wallet: await getWallet(db, id) });
  } catch (error) {
    return errorResponse(error);
  }
}
