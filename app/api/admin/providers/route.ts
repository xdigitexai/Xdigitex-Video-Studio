import { auditRequest, guardMutation, requireAdmin, requireSuperAdmin } from "@/lib/server/context";
import { listProviders } from "@/lib/server/models";
import { adapterFor, providerCodes } from "@/lib/server/providers";
import { listProviderCredentials } from "@/lib/server/providers/service";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { newId, now, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db, env } = await requireAdmin(request);
    const providers = await listProviders(db);
    const result = [];
    for (const provider of providers) {
      const adapter = adapterFor(provider.code);
      const [credentials, models, envKey] =
        await Promise.all([
          listProviderCredentials(db, provider.id),
          db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM ai_models WHERE provider_id = ?`, [provider.id]),
          Promise.resolve(environmentKeyPresent(provider.code, env as unknown as Record<string, unknown>)),
        ]);
      const active = credentials.find((credential) => credential.is_active === 1);
      result.push({
        id: provider.id,
        code: provider.code,
        name: provider.name,
        baseUrl: provider.base_url,
        defaultBaseUrl: adapter?.defaultBaseUrl ?? null,
        isEnabled: provider.is_enabled === 1,
        status: provider.status,
        lastCheckedAt: provider.last_checked_at,
        lastError: provider.last_error,
        sortOrder: provider.sort_order,
        capabilities: adapter?.capabilities ?? [],
        adapterAvailable: Boolean(adapter),
        supportsCancel: adapter?.supportsCancel ?? false,
        modelCount: models?.count ?? 0,
        credential: active
          ? { id: active.id, masked: `••••••••${active.fingerprint}`, fingerprint: active.fingerprint, createdAt: active.created_at }
          : null,
        credentialSource: active ? "database" : envKey ? "environment" : "none",
        credentialHistory: credentials.map((credential) => ({
          id: credential.id,
          masked: `••••••••${credential.fingerprint}`,
          isActive: credential.is_active === 1,
          createdAt: credential.created_at,
          lastUsedAt: credential.last_used_at,
        })),
      });
    }
    return json({ providers: result, availableCodes: providerCodes() });
  } catch (error) {
    return errorResponse(error);
  }
}

function environmentKeyPresent(code: string, env: Record<string, unknown>): boolean {
  const keys: Record<string, string[]> = {
    runway: ["RUNWAY_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    deepseek: ["DEEPSEEK_API_KEY"],
    replicate: ["REPLICATE_API_TOKEN"],
    fal: ["FAL_KEY"],
    stability: ["STABILITY_API_KEY"],
    kling: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
  };
  return (keys[code] ?? []).every((key) => Boolean(env[key]));
}

export async function POST(request: Request) {
  try {
    const { db, actor } = await requireSuperAdmin(request);
    await guardMutation(request, db, "admin-provider-create", 20, 60_000);
    const body = await readJson<{ code?: string; name?: string; baseUrl?: string; isEnabled?: boolean }>(request);
    const code = safeString(body.code, 40).toLowerCase();
    if (!adapterFor(code)) {
      throw new ApiError(400, "No adapter is registered for that provider code.", "ADAPTER_MISSING");
    }
    const existing = await db.first<{ id: string }>(`SELECT id FROM ai_providers WHERE code = ?`, [code]);
    if (existing) throw new ApiError(409, "This provider already exists.", "PROVIDER_EXISTS");
    const name = safeString(body.name, 60) || code;
    const timestamp = now();
    const id = newId("prov");
    await db.run(
      `INSERT INTO ai_providers (id, code, name, base_url, is_enabled, status, last_checked_at, last_error, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'unconfigured', NULL, NULL, 100, ?, ?)`,
      [id, code, name, safeString(body.baseUrl, 300) || adapterFor(code)!.defaultBaseUrl, body.isEnabled === false ? 0 : 1, timestamp, timestamp],
    );
    await auditRequest(db, request, actor, "admin.provider_created", "provider", id, { code });
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
