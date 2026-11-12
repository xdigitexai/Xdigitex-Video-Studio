import type { Db } from "../db";
import type { RuntimeEnv } from "../runtime";
import { ApiError } from "../http";
import { decryptSecret, encryptSecret, fingerprintSecret } from "../crypto";
import { newId, now } from "../util";
import { getProvider, type ProviderRow } from "../models";
import { adapterFor } from "./index";
import {
  type AdapterContext,
  type ConnectionResult,
  type ProviderAdapter,
  type ProviderCredentials,
  ProviderError,
} from "./types";

const ENVIRONMENT_KEYS: Record<string, (env: RuntimeEnv) => ProviderCredentials | null> = {
  runway: (env) => (env.RUNWAY_API_KEY ? { apiKey: env.RUNWAY_API_KEY } : null),
  openai: (env) => (env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : null),
  google: (env) => {
    const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
    return key ? { apiKey: key } : null;
  },
  anthropic: (env) => (env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : null),
  deepseek: (env) => (env.DEEPSEEK_API_KEY ? { apiKey: env.DEEPSEEK_API_KEY } : null),
  replicate: (env) => (env.REPLICATE_API_TOKEN ? { apiKey: env.REPLICATE_API_TOKEN } : null),
  fal: (env) => (env.FAL_KEY ? { apiKey: env.FAL_KEY } : null),
  stability: (env) => (env.STABILITY_API_KEY ? { apiKey: env.STABILITY_API_KEY } : null),
  kling: (env) =>
    env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY
      ? { apiKey: env.KLING_ACCESS_KEY, apiSecret: env.KLING_SECRET_KEY }
      : null,
};

export function parseCredentialPayload(raw: string): ProviderCredentials {
  const value = raw.trim();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return { apiKey: parsed.trim() };
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : typeof record.api_key === "string" ? record.api_key.trim() : "";
      const apiSecret =
        typeof record.apiSecret === "string"
          ? record.apiSecret.trim()
          : typeof record.api_secret === "string"
            ? record.api_secret.trim()
            : undefined;
      if (apiKey) return { apiKey, apiSecret };
    }
  } catch {
    // Not JSON: a raw API key.
  }
  return { apiKey: value };
}

export interface ProviderRuntime {
  provider: ProviderRow;
  adapter: ProviderAdapter;
  context: AdapterContext;
  credentialSource: "database" | "environment";
}

export interface CredentialRow {
  id: string;
  provider_id: string;
  ciphertext: string;
  iv: string;
  fingerprint: string;
  is_active: number;
  created_at: number;
}

export async function resolveProviderRuntime(
  db: Db,
  providerId: string,
  env: RuntimeEnv,
): Promise<ProviderRuntime> {
  const provider = await getProvider(db, providerId);
  if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
  const adapter = adapterFor(provider.code);
  if (!adapter) {
    throw new ApiError(400, "No adapter is registered for this provider.", "ADAPTER_MISSING");
  }
  if (!provider.is_enabled) {
    throw new ApiError(409, `${provider.name} is disabled by the administrator.`, "PROVIDER_DISABLED");
  }

  const stored = await db.first<CredentialRow>(
    `SELECT * FROM provider_credentials WHERE provider_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`,
    [provider.id],
  );
  if (stored) {
    if (!env.SECRETS_ENCRYPTION_KEY) {
      throw new ApiError(
        503,
        "Provider credentials are stored encrypted, but SECRETS_ENCRYPTION_KEY is not configured.",
        "ENCRYPTION_KEY_MISSING",
      );
    }
    let plaintext: string;
    try {
      plaintext = await decryptSecret(stored.ciphertext, stored.iv, env.SECRETS_ENCRYPTION_KEY);
    } catch {
      throw new ApiError(
        503,
        "Stored provider credentials could not be decrypted. Rotate the key in the admin console.",
        "CREDENTIAL_DECRYPT_FAILED",
      );
    }
    const credentials = parseCredentialPayload(plaintext);
    await db.run(`UPDATE provider_credentials SET last_used_at = ? WHERE id = ?`, [now(), stored.id]);
    return {
      provider,
      adapter,
      credentialSource: "database",
      context: {
        baseUrl: provider.base_url || adapter.defaultBaseUrl,
        credentials,
      },
    };
  }

  const fromEnv = ENVIRONMENT_KEYS[provider.code]?.(env) ?? null;
  if (fromEnv?.apiKey) {
    return {
      provider,
      adapter,
      credentialSource: "environment",
      context: { baseUrl: provider.base_url || adapter.defaultBaseUrl, credentials: fromEnv },
    };
  }

  throw new ApiError(
    503,
    `${provider.name} is not connected yet. Add its API key in Admin → Providers.`,
    "PROVIDER_NOT_CONFIGURED",
  );
}

export interface SaveCredentialInput {
  providerId: string;
  apiKey: string;
  apiSecret?: string;
  label?: string;
  encryptionKey?: string;
}

export async function saveProviderCredential(db: Db, input: SaveCredentialInput): Promise<{ fingerprint: string }> {
  const provider = await getProvider(db, input.providerId);
  if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
  const apiKey = input.apiKey?.trim();
  if (!apiKey || apiKey.length < 8) {
    throw new ApiError(400, "Enter a valid API key.", "INVALID_KEY");
  }
  if (!input.encryptionKey || input.encryptionKey.length < 16) {
    throw new ApiError(
      503,
      "SECRETS_ENCRYPTION_KEY must be configured before provider keys can be saved.",
      "ENCRYPTION_KEY_MISSING",
    );
  }
  if (provider.code === "kling" && !input.apiSecret) {
    throw new ApiError(400, "Kling requires an access key and secret key.", "INVALID_KEY");
  }
  const plaintext = input.apiSecret ? JSON.stringify({ apiKey, apiSecret: input.apiSecret }) : apiKey;
  const encrypted = await encryptSecret(plaintext, input.encryptionKey);
  const timestamp = now();
  const id = newId("cred");
  await db.batch([
    {
      sql: `UPDATE provider_credentials SET is_active = 0, rotated_at = ? WHERE provider_id = ? AND is_active = 1`,
      params: [timestamp, provider.id],
    },
    {
      sql: `INSERT INTO provider_credentials (id, provider_id, label, ciphertext, iv, key_version, fingerprint, is_active, created_at, rotated_at, last_used_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, NULL, NULL)`,
      params: [id, provider.id, input.label?.slice(0, 60) || "default", encrypted.ciphertext, encrypted.iv, fingerprintSecret(apiKey), timestamp],
    },
    {
      sql: `UPDATE ai_providers SET status = 'configured', last_error = NULL, updated_at = ? WHERE id = ?`,
      params: [timestamp, provider.id],
    },
  ]);
  return { fingerprint: encrypted.fingerprint };
}

export async function removeProviderCredential(db: Db, providerId: string): Promise<void> {
  const provider = await getProvider(db, providerId);
  if (!provider) throw new ApiError(404, "Provider not found.", "PROVIDER_NOT_FOUND");
  await db.batch([
    { sql: `UPDATE provider_credentials SET is_active = 0, rotated_at = ? WHERE provider_id = ? AND is_active = 1`, params: [now(), provider.id] },
    { sql: `UPDATE ai_providers SET status = 'unconfigured', updated_at = ? WHERE id = ?`, params: [now(), provider.id] },
  ]);
}

export async function listProviderCredentials(db: Db, providerId: string): Promise<Array<{ id: string; label: string; fingerprint: string; is_active: number; created_at: number; rotated_at: number | null; last_used_at: number | null }>> {
  return db.all(
    `SELECT id, label, fingerprint, is_active, created_at, rotated_at, last_used_at
     FROM provider_credentials WHERE provider_id = ? ORDER BY created_at DESC LIMIT 20`,
    [providerId],
  );
}

export interface TestResult extends ConnectionResult {
  providerId: string;
  providerCode: string;
  credentialSource: "database" | "environment";
}

export async function testProviderConnection(
  db: Db,
  providerId: string,
  env: RuntimeEnv,
): Promise<TestResult> {
  const runtime = await resolveProviderRuntime(db, providerId, env);
  let result: ConnectionResult;
  try {
    result = await runtime.adapter.testConnection(runtime.context);
  } catch (error) {
    result = {
      ok: false,
      verified: false,
      detail:
        error instanceof ProviderError
          ? `${error.message} ${error.detail}`.trim()
          : error instanceof Error
            ? error.message
            : "Connection test failed.",
    };
  }
  await db.run(
    `UPDATE ai_providers SET status = ?, last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    [result.ok ? "connected" : "error", now(), result.ok ? null : result.detail.slice(0, 500), now(), runtime.provider.id],
  );
  return {
    ...result,
    providerId: runtime.provider.id,
    providerCode: runtime.provider.code,
    credentialSource: runtime.credentialSource,
  };
}
