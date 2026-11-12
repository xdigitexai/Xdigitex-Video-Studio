"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, LoaderCircle, Plus, Star, Trash2 } from "lucide-react";

export interface AdminModel {
  id: string;
  providerId: string;
  providerName: string;
  providerCode: string;
  code: string;
  displayName: string;
  description: string;
  capabilities: string[];
  pricingUnit: string;
  unitCostMicros: number;
  minChargeMicros: number;
  maxDurationSeconds: number;
  resolutions: string[];
  isActive: boolean;
  isEstimated: boolean;
  isDefaultVideo: boolean;
  isDefaultImage: boolean;
  sortOrder: number;
}

export interface AdminProviderOption {
  id: string;
  code: string;
  name: string;
  isEnabled: boolean;
  capabilities: readonly string[];
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

function ModelRow({ model, providers }: { model: AdminModel; providers: AdminProviderOption[] }) {
  const router = useRouter();
  const provider = providers.find((option) => option.id === model.providerId);
  const adapterCapabilities = [...(provider?.capabilities ?? [])];
  const [form, setForm] = useState({
    displayName: model.displayName,
    description: model.description,
    capabilities: model.capabilities,
    pricingUnit: model.pricingUnit,
    unitCost: (model.unitCostMicros / 1_000_000).toFixed(4),
    minCharge: (model.minChargeMicros / 1_000_000).toFixed(2),
    maxDurationSeconds: String(model.maxDurationSeconds),
    resolutions: model.resolutions.join(", "),
    isActive: model.isActive,
    isEstimated: model.isEstimated,
    sortOrder: String(model.sortOrder),
  });
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
    <details className="card">
      <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="row" style={{ gap: 7 }}>
            <span className="truncate">{model.displayName}</span>
            {model.isDefaultVideo ? <span className="badge badge-lime">default video</span> : null}
            {model.isDefaultImage ? <span className="badge badge-violet">default image</span> : null}
            {!model.isActive ? <span className="badge badge-muted">inactive</span> : null}
          </h3>
          <p className="tiny">{model.providerName} · {model.code} · {model.capabilities.join(", ")}</p>
        </div>
        <span className="small mono">
          ${(model.unitCostMicros / 1_000_000).toFixed(4)} / {model.pricingUnit.replace("per_", "")}
        </span>
      </summary>
      <div className="card-body stack">
        {error ? <div className="notice notice-error">{error}</div> : null}
        {message ? <div className="notice notice-success">{message}</div> : null}
        <div className="form-grid">
          <div className="field">
            <label className="label">Display name</label>
            <input className="input" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          </div>
          <div className="field">
            <label className="label">Provider model code</label>
            <input className="input" value={model.code} disabled />
          </div>
          <div className="field wide">
            <label className="label">Description</label>
            <input className="input" value={form.description} maxLength={300} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
          <div className="field">
            <label className="label">Pricing unit</label>
            <select className="select" value={form.pricingUnit} onChange={(event) => setForm({ ...form, pricingUnit: event.target.value })}>
              <option value="per_second">Per second</option>
              <option value="per_minute">Per minute</option>
              <option value="per_image">Per image</option>
              <option value="per_request">Per request</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Unit cost (USD, provider)</label>
            <input className="input" type="number" step="0.0001" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} />
          </div>
          <div className="field">
            <label className="label">Minimum provider charge (USD)</label>
            <input className="input" type="number" step="0.01" value={form.minCharge} onChange={(event) => setForm({ ...form, minCharge: event.target.value })} />
          </div>
          <div className="field">
            <label className="label">Max duration (seconds)</label>
            <input className="input" type="number" value={form.maxDurationSeconds} onChange={(event) => setForm({ ...form, maxDurationSeconds: event.target.value })} />
          </div>
          <div className="field">
            <label className="label">Resolutions (comma separated)</label>
            <input className="input" value={form.resolutions} onChange={(event) => setForm({ ...form, resolutions: event.target.value })} />
          </div>
          <div className="field">
            <label className="label">Sort order</label>
            <input className="input" type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} />
          </div>
          <div className="field wide">
            <label className="label">Capabilities (only what the adapter implements)</label>
            <div className="row wrap" style={{ gap: 10 }}>
              {adapterCapabilities.map((capability) => (
                <label className="checkbox" key={capability}>
                  <input
                    type="checkbox"
                    checked={form.capabilities.includes(capability)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        capabilities: event.target.checked
                          ? [...form.capabilities, capability]
                          : form.capabilities.filter((value) => value !== capability),
                      })
                    }
                  />
                  <span>{capability.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 14 }}>
          <label className="checkbox"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><span>Active</span></label>
          <label className="checkbox"><input type="checkbox" checked={form.isEstimated} onChange={(event) => setForm({ ...form, isEstimated: event.target.checked })} /><span>Cost is estimated (provider does not report exact cost)</span></label>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy !== ""}
            onClick={() =>
              withBusy("save", async () => {
                await send(`/api/admin/models/${model.id}`, "PATCH", {
                  displayName: form.displayName,
                  description: form.description,
                  capabilities: form.capabilities,
                  pricingUnit: form.pricingUnit,
                  unitCostUsd: Number(form.unitCost),
                  minChargeMicros: Math.round(Number(form.minCharge) * 1_000_000),
                  maxDurationSeconds: Number(form.maxDurationSeconds),
                  resolutions: form.resolutions.split(",").map((value) => value.trim()).filter(Boolean),
                  isActive: form.isActive,
                  isEstimated: form.isEstimated,
                  sortOrder: Number(form.sortOrder),
                });
                return "Model saved.";
              })
            }
          >
            {busy === "save" ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Save model
          </button>
          <button className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => withBusy("video", async () => {
            await send(`/api/admin/models/${model.id}/default`, "POST", { kind: "video" });
            return "Default video model updated.";
          })}>
            {busy === "video" ? <LoaderCircle className="spin" size={13} /> : <Star size={13} />} Default video
          </button>
          <button className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => withBusy("image", async () => {
            await send(`/api/admin/models/${model.id}/default`, "POST", { kind: "image" });
            return "Default image model updated.";
          })}>
            {busy === "image" ? <LoaderCircle className="spin" size={13} /> : <Star size={13} />} Default image
          </button>
          <button className="btn btn-danger btn-sm" disabled={busy !== ""} onClick={() => {
            if (!window.confirm("Delete this model? Models with generation history cannot be deleted — deactivate them instead.")) return;
            void withBusy("delete", async () => {
              await send(`/api/admin/models/${model.id}`, "DELETE");
              return "Model deleted.";
            });
          }}>
            {busy === "delete" ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />} Delete
          </button>
        </div>
      </div>
    </details>
  );
}

export function AdminModels({ models, providers }: { models: AdminModel[]; providers: AdminProviderOption[] }) {
  const router = useRouter();
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    providerId: providers[0]?.id ?? "",
    code: "",
    displayName: "",
    capabilities: [] as string[],
    pricingUnit: "per_request",
    unitCost: "0.05",
    maxDurationSeconds: "10",
  });
  const provider = providers.find((option) => option.id === form.providerId);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await send("/api/admin/models", "POST", {
        providerId: form.providerId,
        code: form.code,
        displayName: form.displayName || form.code,
        capabilities: form.capabilities,
        pricingUnit: form.pricingUnit,
        unitCostUsd: Number(form.unitCost),
        maxDurationSeconds: Number(form.maxDurationSeconds),
      });
      setCreate(false);
      setForm({ ...form, code: "", displayName: "", capabilities: [] });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the model.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row-between wrap">
        <p className="muted small">
          Models are the bridge between providers and plans. The administrator can switch the default model without a
          deployment.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setCreate((value) => !value)}>
          <Plus size={14} /> Add model
        </button>
      </div>

      {create ? (
        <div className="card card-pad">
          {error ? <div className="notice notice-error mb-2">{error}</div> : null}
          <div className="form-grid">
            <div className="field">
              <label className="label">Provider</label>
              <select className="select" value={form.providerId} onChange={(event) => setForm({ ...form, providerId: event.target.value, capabilities: [] })}>
                {providers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Provider model code</label>
              <input className="input" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="e.g. gen4.5" />
            </div>
            <div className="field">
              <label className="label">Display name</label>
              <input className="input" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            </div>
            <div className="field">
              <label className="label">Pricing unit</label>
              <select className="select" value={form.pricingUnit} onChange={(event) => setForm({ ...form, pricingUnit: event.target.value })}>
                <option value="per_second">Per second</option>
                <option value="per_minute">Per minute</option>
                <option value="per_image">Per image</option>
                <option value="per_request">Per request</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Unit cost (USD)</label>
              <input className="input" type="number" step="0.0001" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} />
            </div>
            <div className="field">
              <label className="label">Max duration (seconds)</label>
              <input className="input" type="number" value={form.maxDurationSeconds} onChange={(event) => setForm({ ...form, maxDurationSeconds: event.target.value })} />
            </div>
            <div className="field wide">
              <label className="label">Capabilities</label>
              <div className="row wrap" style={{ gap: 10 }}>
                {[...(provider?.capabilities ?? [])].map((capability) => (
                  <label className="checkbox" key={capability}>
                    <input
                      type="checkbox"
                      checked={form.capabilities.includes(capability)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          capabilities: event.target.checked
                            ? [...form.capabilities, capability]
                            : form.capabilities.filter((value) => value !== capability),
                        })
                      }
                    />
                    <span>{capability.replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
              {!provider?.capabilities.length ? <span className="hint"><AlertTriangle size={11} /> This provider has no implemented capabilities.</span> : null}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !form.code || !form.providerId || !form.capabilities.length}>
            {busy ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />} Create model
          </button>
        </div>
      ) : null}

      {models.map((model) => <ModelRow key={model.id} model={model} providers={providers} />)}
    </div>
  );
}
