import { AppShell } from "@/components/app-shell";
import { AdminProviders, type AdminProvider } from "@/components/admin-providers";
import { loadAdminFrame, shellUser } from "@/lib/server/frame";
import { listProviders } from "@/lib/server/models";
import { ADAPTERS, providerCodes } from "@/lib/server/providers";
import { listProviderCredentials } from "@/lib/server/providers/service";
import { isSuperAdminRole } from "@/lib/server/auth";
import type { RuntimeEnv } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

function hasEnvironmentKey(code: string, env: RuntimeEnv): boolean {
  const mapping: Record<string, string[]> = {
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
  return (mapping[code] ?? []).every((key) => Boolean((env as unknown as Record<string, unknown>)[key]));
}

export default async function AdminProvidersPage() {
  const frame = await loadAdminFrame("/admin/providers");
  const providers = await listProviders(frame.db);
  const rows: AdminProvider[] = [];
  for (const provider of providers) {
    const credentials = await listProviderCredentials(frame.db, provider.id);
    const active = credentials.find((credential) => credential.is_active === 1) ?? null;
    rows.push({
      id: provider.id,
      code: provider.code,
      name: provider.name,
      baseUrl: provider.base_url,
      defaultBaseUrl: ADAPTERS[provider.code]?.defaultBaseUrl ?? null,
      isEnabled: provider.is_enabled === 1,
      status: provider.status,
      lastError: provider.last_error,
      capabilities: [...(ADAPTERS[provider.code]?.capabilities ?? [])],
      modelCount: 0,
      credential: active ? { masked: `••••••••${active.fingerprint}`, fingerprint: active.fingerprint } : null,
      credentialSource: active ? "database" : hasEnvironmentKey(provider.code, frame.env) ? "environment" : "none",
    });
  }

  return (
    <AppShell
      active="admin-providers"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      variant="admin"
      title="AI providers"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ADMIN · INTEGRATIONS</div>
          <h1 className="page-title">AI providers</h1>
          <p className="page-sub">
            Configure endpoints and encrypted API keys, test connections, rotate credentials and disable providers.
          </p>
        </div>
      </div>
      <AdminProviders
        providers={rows}
        availableCodes={providerCodes()}
        canManage={isSuperAdminRole(frame.actor.user.role)}
      />
    </AppShell>
  );
}
