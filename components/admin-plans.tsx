"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Plus, Power, Save } from "lucide-react";

export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  creditsPerPeriod: number;
  videoLimit: number;
  imageLimit: number;
  maxVideoDurationSeconds: number;
  resolutions: string[];
  queuePriority: number;
  maxConcurrentJobs: number;
  storageLimitMb: number;
  premiumFeatures: string[];
  isActive: boolean;
  sortOrder: number;
  modelIds: string[];
}

export interface AdminModelOption {
  id: string;
  name: string;
  provider: string;
}

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function PlanRow({ plan, models }: { plan: AdminPlan; models: AdminModelOption[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: plan.name,
    description: plan.description,
    price: (plan.priceCents / 100).toFixed(2),
    credits: String(plan.creditsPerPeriod),
    videoLimit: String(plan.videoLimit),
    imageLimit: String(plan.imageLimit),
    maxDuration: String(plan.maxVideoDurationSeconds),
    resolutions: plan.resolutions.join(", "),
    queuePriority: String(plan.queuePriority),
    maxConcurrent: String(plan.maxConcurrentJobs),
    storageGb: String(Math.round(plan.storageLimitMb / 1024)),
    isActive: plan.isActive,
    modelIds: plan.modelIds,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await send(`/api/admin/plans/${plan.id}`, "PATCH", {
        name: form.name,
        description: form.description,
        priceCents: Math.round(Number(form.price) * 100),
        creditsPerPeriod: Number(form.credits),
        videoLimit: Number(form.videoLimit),
        imageLimit: Number(form.imageLimit),
        maxVideoDurationSeconds: Number(form.maxDuration),
        resolutions: form.resolutions.split(",").map((value) => value.trim()).filter(Boolean),
        queuePriority: Number(form.queuePriority),
        maxConcurrentJobs: Number(form.maxConcurrent),
        storageLimitMb: Math.round(Number(form.storageGb) * 1024),
        isActive: form.isActive,
        modelIds: form.modelIds,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
        <div>
          <h3>{plan.name} {!plan.isActive ? <span className="badge badge-muted">inactive</span> : null}</h3>
          <p>${(plan.priceCents / 100).toFixed(2)} / month · {plan.creditsPerPeriod} credits · {plan.maxConcurrentJobs} concurrent</p>
        </div>
        <span className="badge badge-lime">{plan.code}</span>
      </summary>
      <div className="card-body">
        {error ? <div className="notice notice-error mb-2">{error}</div> : null}
        <div className="form-grid">
          <div className="field"><label className="label">Name</label><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          <div className="field"><label className="label">Monthly price (USD)</label><input className="input" type="number" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></div>
          <div className="field wide"><label className="label">Description</label><input className="input" value={form.description} maxLength={300} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
          <div className="field"><label className="label">Monthly credits</label><input className="input" type="number" value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} /></div>
          <div className="field"><label className="label">Max clip seconds</label><input className="input" type="number" value={form.maxDuration} onChange={(event) => setForm({ ...form, maxDuration: event.target.value })} /></div>
          <div className="field"><label className="label">Video limit (-1 unlimited)</label><input className="input" type="number" value={form.videoLimit} onChange={(event) => setForm({ ...form, videoLimit: event.target.value })} /></div>
          <div className="field"><label className="label">Image limit (-1 unlimited)</label><input className="input" type="number" value={form.imageLimit} onChange={(event) => setForm({ ...form, imageLimit: event.target.value })} /></div>
          <div className="field"><label className="label">Concurrent jobs</label><input className="input" type="number" min={1} value={form.maxConcurrent} onChange={(event) => setForm({ ...form, maxConcurrent: event.target.value })} /></div>
          <div className="field"><label className="label">Queue priority</label><input className="input" type="number" value={form.queuePriority} onChange={(event) => setForm({ ...form, queuePriority: event.target.value })} /></div>
          <div className="field"><label className="label">Storage (GB)</label><input className="input" type="number" value={form.storageGb} onChange={(event) => setForm({ ...form, storageGb: event.target.value })} /></div>
          <div className="field"><label className="label">Resolutions (comma separated)</label><input className="input" value={form.resolutions} onChange={(event) => setForm({ ...form, resolutions: event.target.value })} /></div>
          <div className="field wide">
            <label className="label">Included models</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {models.map((model) => (
                <label className="checkbox" key={model.id} style={{ minWidth: 210 }}>
                  <input
                    type="checkbox"
                    checked={form.modelIds.includes(model.id)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        modelIds: event.target.checked
                          ? [...form.modelIds, model.id]
                          : form.modelIds.filter((id) => id !== model.id),
                      })
                    }
                  />
                  <span>{model.name} <span className="tiny muted">({model.provider})</span></span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="checkbox">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            <span>Plan is available for new subscriptions</span>
          </label>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={13} /> : saved ? <Check size={13} /> : <Save size={13} />}
            {busy ? "Saving…" : saved ? "Saved" : "Save plan"}
          </button>
        </div>
      </div>
    </details>
  );
}

export function AdminPlans({ plans, models }: { plans: AdminPlan[]; models: AdminModelOption[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("10");
  const [credits, setCredits] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      await send("/api/admin/plans", "POST", {
        code,
        name,
        priceCents: Math.round(Number(price) * 100),
        creditsPerPeriod: Number(credits),
        videoLimit: 30,
        imageLimit: 150,
        maxVideoDurationSeconds: 10,
        resolutions: ["720p"],
        maxConcurrentJobs: 1,
        storageLimitMb: 2048,
        modelIds: models.map((model) => model.id),
      });
      setShowCreate(false);
      setCode("");
      setName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row-between wrap">
        <p className="muted small">Drag-free editing: open a plan, change any limit, save. Changes apply immediately to active subscribers.</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate((value) => !value)}>
          <Plus size={14} /> Add plan
        </button>
      </div>
      {showCreate ? (
        <div className="card card-pad">
          {error ? <div className="notice notice-error mb-2">{error}</div> : null}
          <div className="form-grid">
            <div className="field"><label className="label">Code</label><input className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="studio" /></div>
            <div className="field"><label className="label">Name</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Studio" /></div>
            <div className="field"><label className="label">Price (USD)</label><input className="input" type="number" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></div>
            <div className="field"><label className="label">Monthly credits</label><input className="input" type="number" value={credits} onChange={(event) => setCredits(event.target.value)} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={create} disabled={busy || !code || !name}>
            {busy ? <LoaderCircle className="spin" size={13} /> : <Power size={13} />} Create plan
          </button>
        </div>
      ) : null}
      {plans.map((plan) => <PlanRow key={plan.id} plan={plan} models={models} />)}
    </div>
  );
}
