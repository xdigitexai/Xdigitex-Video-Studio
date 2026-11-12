import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { testProviderConnection } from "@/lib/server/providers/service";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-provider-test", 20, 60_000);
    const { id } = await params;
    const result = await testProviderConnection(db, id, env);
    await auditRequest(db, request, actor, "admin.provider_tested", "provider", id, {
      ok: result.ok,
      verified: result.verified,
      detail: result.detail,
    });
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
