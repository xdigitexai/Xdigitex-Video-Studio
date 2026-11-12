"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";

export interface AdminProvider {
  id: string;
  code: string;
  name: string;
  baseUrl: string | null;
  defaultBaseUrl: string | null;
  isEnabled: boolean;
  status: string;
  lastError: string | null;
  capabilities: string[];
  modelCount: number;
  credential: { masked: string; fingerprint: string } | null;
  credentialSource: "database" | "environment" | "none";
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
  return data;
}

function ProviderCard({ provider, canManage }: { provider: AdminProvider; canManage: boolean }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [enabled, setEnabled] = useState(provider.isEnabled);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function withBusy(key: string, run: () => Promise<string>) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      setMessage(await run());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <span className="provider-logo">{provider.code.slice(0, 2).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <h3 className="truncate">{provider.name}</h3>
            <p className="tiny">
              {provider.capabilities.map((capability) => capability.replace(/_/g, " ")).join(" · ") || "No capabilities"}
            </p>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className={`badge ${provider.status === "connected" ? "badge-ok" : provider.status === "error" ? "badge-danger" : "badge-warn"}`}>
            {provider.status}
          </span>
          <span className={`badge ${provider.isEnabled ? "badge-lime" : "badge-muted"}`}>{provider.isEnabled ? "enabled" : "disabled"}</span>
        </div>
      </div>
      <div className="card-body stack">
        {error ? <div className="notice notice-error">{error}</div> : null}
        {message ? <div className="notice notice-success">{message}</div> : null}
        {provider.lastError ? (
          <div className="notice notice-warn tiny">
            <XCircle size={13} /> {provider.lastError}
          </div>
        ) : null}
        <div className="row-between wrap">
          <span className="small muted">Credential</span>
          <span className="small mono">
            {provider.credential
              ? provider.credential.masked
              : provider.credentialSource === "environment"
                ? "server environment key"
                : "not configured"}
          </span>
        </div>
        {provider.credentialSource === "environment" ? (
          <p className="tiny muted">A key is supplied by the deployment environment. Saving a key here overrides it.</p>
        ) : null}

        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor={`key-${provider.id}`}>API key</label>
            <input
              id={`key-${provider.id}`}
              className="input"
              type="password"
              autoComplete="off"
              placeholder={provider.credential ? "Enter a new key to rotate" : "sk_…"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={!canManage}
            />
          </div>
          {provider.code === "kling" ? (
            <div className="field">
              <label className="label" htmlFor={`secret-${provider.id}`}>Secret key</label>
              <input
                id={`secret-${provider.id}`}
                className="input"
                type="password"
                autoComplete="off"
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                disabled={!canManage}
              />
            </div>
          ) : null}
          <div className="field">
            <label className="label" htmlFor={`url-${provider.id}`}>API base URL</label>
            <input
              id={`url-${provider.id}`}
              className="input"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={provider.defaultBaseUrl ?? ""}
            />
          </div>
          <div className="field">
            <label className="label">Enabled</label>
            <select className="select" value={enabled ? "yes" : "no"} onChange={(event) => setEnabled(event.target.value === "yes")}>
              <option value="yes">Enabled</option>
              <option value="no">Disabled</option>
            </select>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={!canManage || !apiKey || busy !== ""}
            onClick={() =>
              withBusy("key", async () => {
                await send(`/api/admin/providers/${provider.id}/credentials`, "POST", { apiKey, apiSecret: apiSecret || undefined });
                setApiKey("");
                setApiSecret("");
                return "API key saved and encrypted.";
              })
            }
          >
            {busy === "key" ? <LoaderCircle className="spin" size={13} /> : <KeyRound size={13} />}
            {provider.credential ? "Rotate key" : "Save key"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy !== ""}
            onClick={() =>
              withBusy("test", async () => {
                const result = (await send(`/api/admin/providers/${provider.id}/test`, "POST")) as {
                  ok?: boolean;
                  detail?: string;
                  verified?: boolean;
                };
                return `${result.ok ? "Connected" : "Not connected"} · ${result.detail ?? ""}${result.verified === false ? " (unverified)" : ""}`;
              })
            }
          >
            {busy === "test" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />} Test connection
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy !== ""}
            onClick={() =>
              withBusy("save", async () => {
                await send(`/api/admin/providers/${provider.id}`, "PATCH", { baseUrl, isEnabled: enabled, name: provider.name });
                return "Provider settings saved.";
              })
            }
          >
            {busy === "save" ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />} Save settings
          </button>
          {canManage && provider.credential ? (
            <button
              className="btn btn-danger btn-sm"
              disabled={busy !== ""}
              onClick={() =>
                withBusy("remove", async () => {
                  await send(`/api/admin/providers/${provider.id}/credentials`, "DELETE");
                  return "Stored key removed.";
                })
              }
            >
              {busy === "remove" ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />} Remove key
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function AdminProviders({
  providers,
  availableCodes,
  canManage,
}: {
  providers: AdminProvider[];
  availableCodes: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(availableCodes[0] ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    setBusy(true);
    setError("");
    try {
      await send("/api/admin/providers", "POST", { code, name: name || code, isEnabled: true });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the provider.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error ? <div className="notice notice-error">{error}</div> : null}
      {canManage ? (
        <div className="card card-pad">
          <div className="row-between wrap">
            <div>
              <h3 style={{ fontSize: 15 }}>Add a provider</h3>
              <p className="tiny muted">Only adapters implemented in code can be added — no fake integrations.</p>
            </div>
            <div className="inline-form">
              <div className="field">
                <label className="label" htmlFor="new-provider">Adapter</label>
                <select id="new-provider" className="select" value={code} onChange={(event) => setCode(event.target.value)}>
                  {availableCodes.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="new-name">Display name</label>
                <input id="new-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
              </div>
              <button className="btn btn-primary btn-sm" onClick={add} disabled={busy || !code}>
                {busy ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />} Add
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="notice notice-info">
        <ShieldCheck size={15} />
        <span className="small">
          Keys are encrypted with AES-GCM before storage, never returned to the browser, and masked as
          ••••••••+last four. Every save or rotation is written to the audit log.
        </span>
      </div>

      {providers.map((provider) => <ProviderCard key={provider.id} provider={provider} canManage={canManage} />)}
    </div>
  );
}
