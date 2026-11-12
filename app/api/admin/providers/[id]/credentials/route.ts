import { auditRequest, guardMutation, requireAdmin, requireSuperAdmin } from "@/lib/server/context";
import { getProvider } from "@/lib/server/models";
import {
  listProviderCredentials,
  removeProviderCredential,
  saveProviderCredential,
} from "@/lib/server/providers/service";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { db } = await requireAdmin(request);
    const { id } = await params;
    const provider = await getProvider(db, id);
    if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
    const credentials = await listProviderCredentials(db, id);
    return json({
      credentials: credentials
        .filter((credential) => credential.is_active === 1)
        .map((credential) => ({
          id: credential.id,
          label: credential.label,
          masked: `••••••••${credential.fingerprint}`,
          createdAt: credential.created_at,
          lastUsedAt: credential.last_used_at,
        })),
      history: credentials.map((credential) => ({
        id: credential.id,
        label: credential.label,
        masked: `••••••••${credential.fingerprint}`,
        isActive: credential.is_active === 1,
        createdAt: credential.created_at,
        rotatedAt: credential.rotated_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { db, env, actor } = await requireSuperAdmin(request);
    await guardMutation(request, db, "admin-credential-save", 20, 60_000);
    const { id } = await params;
    const body = await readJson<{ apiKey?: string; apiSecret?: string; label?: string }>(request);
    const result = await saveProviderCredential(db, {
      providerId: id,
      apiKey: String(body.apiKey ?? ""),
      apiSecret: body.apiSecret ? String(body.apiSecret) : undefined,
      label: safeString(body.label, 60),
      encryptionKey: env.SECRETS_ENCRYPTION_KEY,
    });
    await auditRequest(db, request, actor, "admin.provider_credential_saved", "provider", id, {
      fingerprint: result.fingerprint,
    });
    return json({ ok: true, masked: `••••••••${result.fingerprint}` }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { db, actor } = await requireSuperAdmin(request);
    await guardMutation(request, db, "admin-credential-remove", 10, 60_000);
    const { id } = await params;
    await removeProviderCredential(db, id);
    await auditRequest(db, request, actor, "admin.provider_credential_removed", "provider", id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
